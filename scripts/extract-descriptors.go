// extract-descriptors.go extracts FileDescriptorProto blobs from a stripped
// Go app binary used by UGOS and prints a compact catalog as JSON.
//
// Usage:
//   go run extract-descriptors.go /path/to/filemgr_serv > catalog-filemgr.json
//
// The scanner relies on the Go generated code's constant pattern:
//   0a <len> "<file>.proto" 12 <len> "<package>" ...
// It walks protobuf wire fields to find the end of each descriptor, then
// unmarshals it into descriptorpb.FileDescriptorProto.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"sort"

	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

type Field struct {
	Name     string `json:"name"`
	Number   int32  `json:"number"`
	Type     string `json:"type"`
	TypeName string `json:"typeName,omitempty"`
	Repeated bool   `json:"repeated,omitempty"`
	JsonName string `json:"jsonName,omitempty"`
	Oneof    int32  `json:"oneof,omitempty"`
}

type Msg struct {
	Name     string  `json:"name"`
	Fields   []Field `json:"fields"`
	MapEntry bool    `json:"mapEntry,omitempty"`
}

type Method struct {
	Name   string `json:"name"`
	Input  string `json:"input"`
	Output string `json:"output"`
}

type Svc struct {
	Name    string            `json:"name"`
	Methods map[string]Method `json:"methods"`
}

type Catalog struct {
	Files    []string          `json:"files"`
	Messages map[string]Msg    `json:"messages"`
	Enums    map[string][]string `json:"enums"`
	Services map[string]Svc    `json:"services"`
}

func scanDescriptor(d []byte, start int) int {
	pos := start
	for pos < len(d) {
		num, typ, n := protowire.ConsumeTag(d[pos:])
		if n < 0 { break }
		pos += n
		m := protowire.ConsumeFieldValue(num, typ, d[pos:])
		if m < 0 { break }
		pos += m
	}
	return pos
}

func protoType(t descriptorpb.FieldDescriptorProto_Type) string {
	// TYPE_STRING -> STRING
	return t.String()[5:]
}

func collect(prefix string, msgs []*descriptorpb.DescriptorProto, enums []*descriptorpb.EnumDescriptorProto, out *Catalog) {
	for _, en := range enums {
		full := prefix + "." + en.GetName()
		values := make([]string, 0, len(en.GetValue()))
		for _, v := range en.GetValue() { values = append(values, v.GetName()) }
		out.Enums[full] = values
	}
	for _, m := range msgs {
		full := prefix + "." + m.GetName()
		fields := make([]Field, 0, len(m.GetField()))
		for _, f := range m.GetField() {
			field := Field{
				Name: f.GetName(), Number: f.GetNumber(), Type: protoType(f.GetType()),
				Repeated: f.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED,
				JsonName: f.GetJsonName(), Oneof: f.GetOneofIndex(),
			}
			if f.GetTypeName() != "" { field.TypeName = string(f.GetTypeName()) }
			fields = append(fields, field)
		}
		out.Messages[full] = Msg{Name: full, Fields: fields, MapEntry: m.GetOptions().GetMapEntry()}
		collect(full, m.GetNestedType(), m.GetEnumType(), out)
	}
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: go run extract-descriptors.go <app-binary>")
		os.Exit(2)
	}
	d, err := os.ReadFile(os.Args[1])
	if err != nil { panic(err) }
	needle := []byte(".proto")
	off := 0
	seen := map[string]bool{}
	cat := Catalog{Messages: map[string]Msg{}, Enums: map[string][]string{}, Services: map[string]Svc{}}
	for {
		rel := bytes.Index(d[off:], needle)
		if rel < 0 { break }
		idx := off + rel
		off = idx + 1
		for s := idx - 2; s >= idx-300 && s >= 0; s-- {
			if d[s] != 0x0a { continue }
			l := int(d[s+1])
			if l < 3 || s+2+l > len(d) { continue }
			name := string(d[s+2 : s+2+l])
			if !bytes.HasSuffix([]byte(name), needle) || seen[name] { continue }
			e := scanDescriptor(d, s)
			if e <= s+2+l { continue }
			var fd descriptorpb.FileDescriptorProto
			if err := proto.Unmarshal(d[s:e], &fd); err != nil || fd.GetName() != name { continue }
			seen[name] = true
			cat.Files = append(cat.Files, name)
			pkg := fd.GetPackage()
			collect(pkg, fd.GetMessageType(), fd.GetEnumType(), &cat)
			for _, svc := range fd.GetService() {
				full := pkg + "." + svc.GetName()
				methods := map[string]Method{}
				for _, m := range svc.GetMethod() {
					methods[m.GetName()] = Method{Name: m.GetName(), Input: string(m.GetInputType()), Output: string(m.GetOutputType())}
				}
				cat.Services[full] = Svc{Name: full, Methods: methods}
			}
			break
		}
	}
	sort.Strings(cat.Files)
	out, _ := json.MarshalIndent(cat, "", "  ")
	fmt.Print(string(out))
}
