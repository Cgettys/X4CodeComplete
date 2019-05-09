from xml.etree.ElementTree import *
tree = ElementTree()
tree.parse("scriptproperties.xml")

unique = {}

def add(key, val):
    k = key.replace("{$", "").replace("}","")
    v = val.replace("{$", "").replace("}","")
    if (v is "string"):
        v = ""
    elif v is "":
        return
    if key in unique:
        unique[k].add(v)
    else:
        unique[k] = set()
        unique[k].add(v)

def process_entry(e: ElementTree):
    name = e.attrib["name"]

    for y in e.iter("property"):
        splits = y.attrib["name"].split(".")
        if (not splits):
            continue
        last = name
        for z in splits:
            if ("<" in z or ">" in z):
                # TODO is this what we want?
                add(last, "")
                last = ""
            elif ("${" in z or "}" in z):
                next = z
                add(last, next)
                last = next
                # TODO break here?
            else:
                add(last, z)
                last = z
        if("type" in y.attrib):
            add(splits[-1], y.attrib["type"])

for x in tree.iter("keyword"):
    process_entry(x)
for x in tree.iter("datatype"):
    process_entry(x)
add("boolean","true")
add("boolean","false")
print(len(unique))
print("{")
for k in unique:
    print("'"+k+"':", list(unique[k]),",")

print("}")