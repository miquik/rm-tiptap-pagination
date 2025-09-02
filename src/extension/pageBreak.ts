import { Node } from "@tiptap/core";

export const PageBreak = Node.create({
  name: "pb",

  priority: 900,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      type: {
        default: null,
        keepOnSplit: false,
      },
      bid: {
        default: null,
        renderHTML: attributes => {
          return { 'data-bid': attributes.bid }
        },
        parseHTML: element => element.getAttribute('data-bid'),
      }
    };
  },

  atom: true,

  group: "block",

  draggable: false,

  // Se il tag contengono l'attributo uid
  // allora converto a LINKEDLEMENT
  parseHTML() {
    return [{ tag: "p[data-break]" }];
  },

  // https://discuss.prosemirror.net/t/firefox-contenteditable-false-cursor-bug/5016/2
  renderHTML({ HTMLAttributes }) {
    const { type } = HTMLAttributes;

    
    const attrs: Record<string, unknown> = {};
    attrs["data-break"] = type || 'after';
    attrs["data-bid"] = HTMLAttributes['data-bid'] 
    attrs["draggable"] = false;
    return ["p", attrs, 0];
  },
});
