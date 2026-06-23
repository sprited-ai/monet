#!/usr/bin/env python3
"""Convert a ComfyUI **UI workflow** JSON (nodes/links) into **API prompt** format
({node_id: {class_type, inputs}}) that POSTs to /prompt.

ComfyUI only does this conversion in the browser frontend; this replicates it headlessly
so we can fire saved workflows from scripts / the console Worker. Needs the live server's
/object_info to know each node's input order + which inputs are widgets.

Usage:
  python3 ui2api.py workflow.json --comfy http://127.0.0.1:8188 -o workflow.api.json
"""
import argparse, json, sys, urllib.request

SKIP_TYPES = {"Note", "MarkdownNote", "Reroute", "PrimitiveNode", "PrimitiveString",
              "PrimitiveInt", "PrimitiveFloat", "PrimitiveBoolean"}
WIDGET_SCALARS = {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"}


def fetch_object_info(base):
    with urllib.request.urlopen(f"{base.rstrip('/')}/object_info", timeout=60) as r:
        return json.load(r)


def is_widget(type_field):
    # widget if it's a combo (list of choices) or a basic scalar type
    if isinstance(type_field, list):
        return True
    return type_field in WIDGET_SCALARS


def convert(wf, oinfo):
    nodes = {n["id"]: n for n in wf["nodes"]}
    # links: [id, from_node, from_slot, to_node, to_slot, type]
    links = {l[0]: l for l in wf.get("links", [])}

    # resolve Reroute passthrough: map (reroute_id) -> upstream [node, slot]
    def resolve_link(link_id):
        l = links.get(link_id)
        if not l:
            return None
        src_id, src_slot = l[1], l[2]
        src = nodes.get(src_id)
        if src and src["type"] == "Reroute":
            up = src.get("inputs", [{}])[0].get("link")
            return resolve_link(up) if up is not None else None
        return [str(src_id), src_slot]

    api = {}
    for nid, n in nodes.items():
        ctype = n["type"]
        if ctype in SKIP_TYPES:
            continue
        defn = oinfo.get(ctype)
        if not defn:
            print(f"!! unknown node type {ctype!r} (id {nid}) — skipping", file=sys.stderr)
            continue
        inp = defn.get("input", {})
        ordered = list(inp.get("required", {}).items()) + list(inp.get("optional", {}).items())

        # which inputs are connected via links (by socket name)
        connected = {}
        for socket in n.get("inputs", []):
            if socket.get("link") is not None:
                r = resolve_link(socket["link"])
                if r:
                    connected[socket["name"]] = r

        api_inputs = {}
        widgets = list(n.get("widgets_values", []) or [])
        wi = 0
        for name, spec in ordered:
            type_field = spec[0] if isinstance(spec, list) and spec else spec
            opts = spec[1] if isinstance(spec, list) and len(spec) > 1 and isinstance(spec[1], dict) else {}
            if name in connected:
                api_inputs[name] = connected[name]
                continue
            if is_widget(type_field):
                if wi < len(widgets):
                    api_inputs[name] = widgets[wi]
                    wi += 1
                    # seed-like widgets carry a trailing control_after_generate value
                    if opts.get("control_after_generate") and wi < len(widgets):
                        wi += 1
        api[str(nid)] = {"class_type": ctype, "inputs": api_inputs}
    return api


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workflow")
    ap.add_argument("--comfy", default="http://127.0.0.1:8188")
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()
    wf = json.load(open(a.workflow))
    oinfo = fetch_object_info(a.comfy)
    api = convert(wf, oinfo)
    json.dump(api, open(a.out, "w"), indent=2)
    print(f"== {len(api)} nodes -> {a.out}")


if __name__ == "__main__":
    main()
