"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { editorContent } from "@/lib/contents/table-plus-with-pagination";
import { Toolbar } from "@/ui/editor/toolbar";
// import { PaginationTable } from "tiptap-table-plus";
import { PaginationTable } from "@/tableplus";
import { PaginationPlusM22 } from "@/plugin/paginationPlusM22";
import { PaginationPlus } from "@/plugin/paginationPlus";
import { PageBreak } from "@/extension/pageBreak";
// import { PaginationPlus } from "tiptap-pagination-plus";

const { TableCellPlus, TableHeaderPlus, TableRowPlus, TablePlus } = PaginationTable;

const TiptapEditor = ({onlyEditor}: {onlyEditor: boolean}) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      TablePlus,
      TableRowPlus,
      TableCellPlus,
      TableHeaderPlus,
      PageBreak,
      PaginationPlusM22.configure({
        pageHeight: 800,
        pageGap: 20,
        pageBreakBackground: "hsl(var(--background))",
        pageHeaderHeight: 40,
        // pageFooterHeight: 25,
        footerRight: "Made with ❤️ by Romik",
        footerLeft: "Page {page}",
        headerLeft: "Header Left",
        headerRight: "Header Right",
        // marginTop: 30,
        // marginBottom: 50,
        // marginLeft: 70,
        // marginRight: 70,
        // contentMarginTop: 30,
        // contentMarginBottom: 30,
      }),
    ],
    content: editorContent,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[200px]",
      },
    },
    onUpdate: ({ editor }) => {
      console.log(editor.getJSON());
    },
  });

  if (!editor) {
    return null;
  }


  return (
    <div className="">
      <Toolbar onlyEditor={onlyEditor} optionsList={["undo", "redo", "bold", "italic", "underline", "strikethrough", "heading", "table"]} editor={editor} />
      <div className="">
        <EditorContent
          editor={editor}
          className="w-full border mb-5 mt-2"
          id="editor"
        />
      </div>
    </div>
  );
};

export default TiptapEditor;
