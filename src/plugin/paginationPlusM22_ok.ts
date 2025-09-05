import { Editor, Extension } from "@tiptap/core";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";

let debugCounter = 0
const MIN_H_GUARD = 4

export interface PaginationPlusOptions {
  pageHeight: number;
  pageGap: number;
  pageBreakBackground: string;
  pageHeaderHeight: number;
  pageFooterHeight: number;
  pageGapBorderSize: number;
  footerRight: string;
  footerLeft: string;
  headerRight: string;
  headerLeft: string;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  contentMarginTop: number;
  contentMarginBottom: number;
}

type PageInfo = {
  index: number;
  mt: number;
  // children index start
  cis: number;
  // children index end
  cie: number;
};

type VDivInfo = {
  type: number; // 0 = PAGEBREAK, 1 = FIGURE
  dir: number; // -1 = before, 1 = after
  height: number;
  lastBottom: number;
};

interface PaginationPlusStorageOptions {
  ignoreObserver: boolean
  vdivs: Map<string, VDivInfo>
}


type DecoSets = {
  vdivs: DecorationSet; // 
  pageCount: DecorationSet; // es: pageCount
};

function mergeSets(
  doc: ProseMirrorNode,
  a: DecorationSet,
  b: DecorationSet
): DecorationSet {
  // `find()` senza argomenti restituisce tutte le decorazioni del set
  const all = [...a.find(), ...b.find()];
  return DecorationSet.create(doc, all);
}

const vdivsMustBeRecalculated = (
  pbs: NodeListOf<Element>,
  vdivs: Map<string, VDivInfo>
) => {
  // il numero di pbs è cambiato
  if (pbs.length != vdivs.size) {
    return true;
  }
  // offsetTop di qualche pbs è cambiato
  for (const pb of pbs) {
    const pbElement = pb as HTMLElement
    const br = vdivs.get(pbElement.dataset.bid ?? "")
    if (!br || Math.abs(pbElement.offsetTop + pbElement.offsetHeight - br.lastBottom) > MIN_H_GUARD) {
      return true;
    }
  }

  // la struttura dei pbs non è più corretta (vdiv-spacer deve essere il vicino superiore o inferiore del pb)
  for (const pb of pbs) {
    if (
      pb.nextElementSibling?.classList.contains("vdiv-spacer") === false &&
      pb.previousElementSibling?.classList.contains("vdiv-spacer") === false
    ) {
      return true;
    }
  }

  return false;
};

let pauseObserver = false;

const page_count_meta_key = "PAGE_COUNT_META_KEY";
const vdivs_meta_key = "VDIVS_META_KEY";

export const PaginationPlusM22 = Extension.create<PaginationPlusOptions>({
  name: "PaginationPlus",
  addOptions() {
    return {
      pageHeight: 800,
      pageGap: 50,
      pageGapBorderSize: 1,
      pageBreakBackground: "#ffffff",
      pageHeaderHeight: 30,
      pageFooterHeight: 30,
      footerRight: "{page}",
      footerLeft: "",
      headerRight: "",
      headerLeft: "",
      marginTop: 20,
      marginBottom: 20,
      marginLeft: 50,
      marginRight: 50,
      contentMarginTop: 10,
      contentMarginBottom: 10,
    };
  },
  addStorage() {
    return {
      ignoreObserver: false,
      vdivs: new Map<string, VDivInfo>(),
    } as PaginationPlusStorageOptions;
  },
  onCreate() {
    const targetNode = this.editor.view.dom;
    targetNode.classList.add("rm-with-pagination");
    targetNode.style.marginLeft = this.options.marginLeft + "px";
    targetNode.style.marginRight = this.options.marginRight + "px";
    const config = { attributes: true };
    const headerFooterHeight = this.options.pageHeaderHeight + this.options.pageFooterHeight;
    const _pageContentHeight = this.options.pageHeight - headerFooterHeight - this.options.contentMarginTop - this.options.contentMarginBottom - this.options.marginTop - this.options.marginBottom;

    const style = document.createElement("style");
    style.dataset.rmPaginationStyle = "";

    style.textContent = `
      .rm-with-pagination {
        counter-reset: page-number;
      }
      .rm-with-pagination .image-plus-wrapper,
      .rm-with-pagination .table-plus td,
      .rm-with-pagination .table-plus th {
        max-height: ${_pageContentHeight - 10}px;
        overflow-y: auto;
      }
      .rm-with-pagination .image-plus-wrapper {
        overflow-y: visible;
      }
      .rm-with-pagination .rm-page-footer {
        counter-increment: page-number;
        margin-bottom: ${this.options.marginBottom}px;
      }
      .rm-with-pagination .rm-page-break:last-child .rm-pagination-gap {
        display: none;
      }
      .rm-with-pagination .rm-page-break:last-child .rm-page-header {
        display: none;
      }
      
      .rm-with-pagination table tr td,
      .rm-with-pagination table tr th {
        word-break: break-all;
      }
      .rm-with-pagination table > tr {
        display: grid;
        min-width: 100%;
      }
      .rm-with-pagination table {
        border-collapse: collapse;
        width: 100%;
        display: contents;
      }
      .rm-with-pagination table tbody{
        display: table;
        max-height: 300px;
        overflow-y: auto;
      }
      .rm-with-pagination table tbody > tr{
        display: table-row !important;
      }
      .rm-with-pagination p:has(br.ProseMirror-trailingBreak:only-child) {
        display: table;
        width: 100%;
      }
      .rm-with-pagination .table-row-group {
        max-height: ${_pageContentHeight}px;
        overflow-y: auto;
        width: 100%;
      }
      .rm-with-pagination .rm-page-footer-left,
      .rm-with-pagination .rm-page-footer-right,
      .rm-with-pagination .rm-page-header-left,
      .rm-with-pagination .rm-page-header-right {
        display: inline-block;
      }
      
      .rm-with-pagination .rm-page-header-left,
      .rm-with-pagination .rm-page-footer-left{
        float: left;
        margin-left: ${this.options.marginLeft}px;
      }
      .rm-with-pagination .rm-page-header-right,
      .rm-with-pagination .rm-page-footer-right{
        float: right;
        margin-right: ${this.options.marginRight}px;
      }
      .rm-with-pagination .rm-page-number::before {
        content: counter(page-number);
      }
      .rm-with-pagination .rm-first-page-header{
        display: inline-flex;
        justify-content: space-between;
        width: 100%;
      }
      .rm-with-pagination .rm-page-header,
      .rm-with-pagination .rm-first-page-header{
        margin-bottom: ${this.options.contentMarginTop}px !important;
        margin-top: ${this.options.marginTop}px !important;
      }
      .rm-with-pagination .rm-page-footer{
        margin-top: ${this.options.contentMarginBottom}px !important;
        margin-bottom: ${this.options.marginBottom}px !important;
      }
    `;
    document.head.appendChild(style);

    const refreshPage = (targetNode: HTMLElement) => {
      const paginationElement = targetNode.querySelector(
        "[data-rm-pagination]"
      );
      if (paginationElement) {
        const lastPageBreak = paginationElement.lastElementChild?.querySelector(
          ".breaker"
        ) as HTMLElement;
        if (lastPageBreak) {
          const minHeight =
            lastPageBreak.offsetTop + lastPageBreak.offsetHeight;
          targetNode.style.minHeight = `${minHeight}px`;
        }
      }
    };

    const callback = (
      mutationList: MutationRecord[]
    ) => {
      for (const m of mutationList) {
        if (m.target && !pauseObserver) {
          const pbs = this.editor.view.dom.querySelectorAll("[data-break]");
          if (
            vdivsMustBeRecalculated(
              pbs,
              this.editor.storage.PaginationPlus.vdivs
            )
          ) {
            // ricalcoliamo le altezze dei PBS
            pauseObserver = true;

            calculateVDivsHeight(
              this.editor.view,
              this.editor.storage,
              this.options
            );

            
            // DEBUG
            const currentPageCount = getExistingPageCount(this.editor.view);
            const pageCount = calculatePageCount(
              this.editor.view,             
              this.options
            );
            console.log('breaks: %d - exist: %d - calc: %d', debugCounter++, currentPageCount, pageCount)
            
            const tr = this.editor.view.state.tr.setMeta(
              vdivs_meta_key,
              Date.now()
            );
            this.editor.view.dispatch(tr);

            pauseObserver = false;
          }

          const _target = m.target as HTMLElement;
          if (_target.classList.contains("rm-with-pagination")) {
            const currentPageCount = getExistingPageCount(this.editor.view);
            const pageCount = calculatePageCount(
              this.editor.view,              
              this.options
            );
            if (currentPageCount !== pageCount) {
              console.log('pageCount: %d - exist: %d - calc: %d', debugCounter++, currentPageCount, pageCount)
              const tr = this.editor.view.state.tr.setMeta(
                page_count_meta_key,
                Date.now()
              );
              this.editor.view.dispatch(tr);
            }

            refreshPage(_target);
          }
        }
      }
    };
    const observer = new MutationObserver(callback);
    observer.observe(targetNode, config);
    refreshPage(targetNode);
  },
  addProseMirrorPlugins() {
    const pageOptions = this.options;
    const editor = this.editor;
    return [
      new Plugin<DecoSets>({
        key: new PluginKey<DecoSets>("pagination"),

        state: {
          init(_, state) {
            const widgetList = createDecoration(
              editor,
              state,
              pageOptions,
              true
            );
            const widgeDivsList = createDividerDecoration(
                editor,
                state
              );
            return {
              vdivs: DecorationSet.create(state.doc, [...widgeDivsList]),
              pageCount: DecorationSet.create(state.doc, [...widgetList]),
            };
          },
          apply(tr, oldDeco, _, newState) {
            let { vdivs, pageCount } = oldDeco;
            if (tr.docChanged) {
              vdivs = vdivs.map(tr.mapping, tr.doc);
              pageCount = pageCount.map(tr.mapping, tr.doc);
            }

            if (tr.getMeta(vdivs_meta_key)) {
              const widgetList = createDividerDecoration(
                editor,
                newState
              );
              vdivs = DecorationSet.create(newState.doc, [...widgetList]);
            }

            if (tr.getMeta(page_count_meta_key)) {
              const widgetList = createDecoration(
                editor,
                newState,
                pageOptions
              );
              pageCount = DecorationSet.create(newState.doc, [...widgetList]);
            }
            return { vdivs, pageCount };
          },
        },

        props: {
          decorations(state: EditorState) {
            const s = this.getState(state);
            if (!s) return null;
            return mergeSets(state.doc, s.vdivs, s.pageCount);
          },
        },
      }),
    ];
  },
});

const getExistingPageCount = (view: EditorView) => {
  const editorDom = view.dom;
  const paginationElement = editorDom.querySelector("[data-rm-pagination]");
  if (paginationElement) {
    return paginationElement.children.length;
  }
  return 0;
};
const calculatePageCount = (
  view: EditorView,
  pageOptions: PaginationPlusOptions
) => {
  const editorDom = view.dom;
  const _pageHeaderHeight = pageOptions.pageHeaderHeight + pageOptions.contentMarginTop + pageOptions.marginTop;
  const _pageFooterHeight = pageOptions.pageFooterHeight + pageOptions.contentMarginBottom + pageOptions.marginBottom;
  const pageContentAreaHeight =
    pageOptions.pageHeight - _pageHeaderHeight - _pageFooterHeight;
  const paginationElement = editorDom.querySelector("[data-rm-pagination]");
  const currentPageCount = getExistingPageCount(view);
  if (paginationElement) {
    const lastElementOfEditor = editorDom.lastElementChild;
    const lastPageBreak =
      paginationElement.lastElementChild?.querySelector(".breaker");
    if (lastElementOfEditor && lastPageBreak) {
      const lastPageGap =
        lastElementOfEditor.getBoundingClientRect().bottom -
        lastPageBreak.getBoundingClientRect().bottom;
      if (lastPageGap > 0) {
        const addPage = Math.ceil(lastPageGap / pageContentAreaHeight);
        return currentPageCount + addPage;
      } else {
        const lpFrom = -pageOptions.pageHeaderHeight;
        const lpTo = -(pageOptions.pageHeight - pageOptions.pageHeaderHeight);
        if (lastPageGap > lpTo && lastPageGap < lpFrom) {
          return currentPageCount;
        } else if (lastPageGap < lpTo) {
          const pageHeightOnRemove =
            pageOptions.pageHeight + pageOptions.pageGap;
          const removePage = Math.floor(lastPageGap / pageHeightOnRemove);
          return currentPageCount + removePage;
        } else {
          return currentPageCount;
        }
      }
    }
    return 1;
  } else {
    const editorHeight = editorDom.scrollHeight;
    const pageCount = Math.ceil(editorHeight / pageContentAreaHeight);
    return pageCount <= 0 ? 1 : pageCount;
  }
};

function addTempBreakElement(bid: string, breakHeight: number) {
  const pageVDiv = document.createElement("div");
  pageVDiv.classList.add("vdiv-spacer");
  pageVDiv.style.width = "100%";
  pageVDiv.style.backgroundColor = "green";
  pageVDiv.style.height = (breakHeight || 0) + "px";
  pageVDiv.dataset["bid"] = bid;
  return pageVDiv;
}

function getDividerPosition(
  bottom: number,
  pageHeight: number
): PageInfo {
  return {
    index: Math.floor(bottom / pageHeight),
    mt: bottom % pageHeight,
    cis: -1,
    cie: -1,
  }
}
/*
function getPagesInfo(
  top: number,
  firstHeight: number,
  pageHeight: number
): PageInfo {
  if (top < firstHeight) {
    return {
      index: 0,
      mt: top % firstHeight,
      cis: -1,
      cie: -1,
    };
  }

  const pageTop = (top - firstHeight) % pageHeight;
  const idx = Math.floor((top - firstHeight) / pageHeight) + 1;
  return {
    index: idx,
    mt: pageTop,
    cis: -1,
    cie: -1,
  };
}
*/


const calculateVDivsHeight = (
  view: EditorView,
  store: Record<string, unknown>,
  pageOptions: PaginationPlusOptions
) => {
  // L'idea è quella di modificare le altezze dei vdiv-spacer esistenti
  const storage = store.PaginationPlus as PaginationPlusStorageOptions
  const editorDom = view.dom;

  const _pageGap = pageOptions.pageGap;
  const _pageHeaderHeight = (pageOptions.pageHeaderHeight + pageOptions.contentMarginTop + pageOptions.marginTop);
  const _pageFooterHeight = (pageOptions.pageFooterHeight + pageOptions.contentMarginBottom + pageOptions.marginBottom);
  // const _pageHeight = pageOptions.pageHeight - _pageHeaderHeight - _pageFooterHeight;

  // const headerFooterHeight = _pageHeaderHeight + _pageFooterHeight + _pageGap
  

  const paginationElement = editorDom.querySelector("[data-rm-pagination]");
  // const HEADING = editorDom.querySelector(".heading") as HTMLElement;

  if (paginationElement) {
    const existingPage = getExistingPageCount(view);

    const pbs = editorDom.querySelectorAll("[data-break]");
    if (pbs && pbs.length > 0) {
      // 1. Stimiamo una quantità di pagine che potrebbero risultare dopo l'algoritmo
      let pageCount = calculatePageCount(view, pageOptions);
      pageCount += pbs.length + 2;

      // 2. Se serve, aggiungiamo PageBreakDefinition che mancano
      if (paginationElement.children.length < pageCount) {
        for (let i = 0; i < pageCount - existingPage; i++) {
          // aggiungiamo pagine fake
          paginationElement.appendChild(
            emptyPageBreakDefinition(
              pageOptions.pageHeight,
              pageOptions.pageHeaderHeight,
              pageOptions.pageGap,
              view.dom.clientWidth
            )
          );
        }
      }

      // 3. Aggiorniamo le altezze del divisori
      const pageVDivs = editorDom.querySelectorAll(".vdiv-spacer");

      for (const pb of pbs) {
        const pbElement = pb as HTMLElement;      

        // N.B. l'idea è che il "blocco" pb + vdiv deve essere considerato come una singola identità
        // per non sbagliare i calcoli
        const height = pbElement.offsetHeight
        let offsetBottom = pbElement.offsetTop + height
        if (
          pbElement.dataset.break === "before" &&
          (pbElement.previousElementSibling as HTMLElement).classList.contains("vdiv-spacer")
        ) {
          offsetBottom = (pbElement.previousElementSibling as HTMLElement).offsetTop + height
        }
        
        if (pbElement.dataset.break === "after") {
          const pi = getDividerPosition(
            offsetBottom, 
            pageOptions.pageHeight + _pageGap
          )

          // let breakHeight = pageOptions.pageHeight + _pageHeaderHeight + _pageGap - pi.mt
          let breakHeight = pageOptions.pageHeight + _pageHeaderHeight + _pageGap - pi.mt
          /*
          const pi = getPagesInfo(
            dirOffsetTop + (pad || 0),
            pageContentAreaHeight +
              pageOptions.pageHeaderHeight +
              headerFooterHeight,
            pageContentAreaHeight + headerFooterHeight,
            // headerFooterHeight
          );

          let breakHeight =
            (pi.index === 0
              ? pageContentAreaHeight + pageOptions.pageHeaderHeight + 0
              : pageContentAreaHeight + 0) -
            pi.mt -
            0; // height;
          */
          if (breakHeight < 0) {
            breakHeight = 1;
          }

          storage.vdivs.set(pbElement.dataset.bid!, {
            type: 0,
            dir: 1,
            height: breakHeight,
            lastBottom: offsetBottom
          });
          // storage.breaksLastTop[index] = pbElement.offsetTop;

          let pageVDiv = null
          for (const pv of pageVDivs) {
            if ((pv as HTMLElement).dataset.bid === pbElement.dataset.bid) {
                pageVDiv = (pv as HTMLElement)
                break;
            }
          }

          // Se il divisore esiste modifichiamo l'altezza, altrimenti creiamo un nuovo divisore
          if (pageVDiv) {
            const minH = `${breakHeight}px`;
            pageVDiv.style.minHeight = minH;
          } else {
            // il divisore non esiste, lo creiamo
            if (pbElement.nextElementSibling) {
              view.dom.insertBefore(
                addTempBreakElement(pbElement.dataset.bid!, breakHeight),
                pbElement.nextElementSibling
              );
            } else {
              view.dom.append(
                addTempBreakElement(pbElement.dataset.bid!, breakHeight)
              );
            }
          }
        }

        if (pbElement.dataset.break === "before") {
          const pi = getDividerPosition(
            offsetBottom, 
            pageOptions.pageHeight - _pageFooterHeight
          )

          let breakHeight = pageOptions.pageHeight + _pageHeaderHeight + _pageGap - pi.mt
          /*         
          const dirOffsetTop = offsetTop + height;
          const pi = getPagesInfo(
            dirOffsetTop,
            pageContentAreaHeight +
              pageOptions.pageHeaderHeight +
              headerFooterHeight,
            pageContentAreaHeight + headerFooterHeight,
            // headerFooterHeight
          );

          let breakHeight =
            (pi.index === 0
              ? pageContentAreaHeight + pageOptions.pageHeaderHeight + headerFooterHeight
              : pageContentAreaHeight + headerFooterHeight) -
            pi.mt + height;
          const pad = null
          if (pad) {
            pbElement.style.marginTop = `${pad}px`;
          }
          */
          
          if (breakHeight < 0) {
            breakHeight = 1;
          }
         
          let pageVDiv = null
          for (const pv of pageVDivs) {
            if ((pv as HTMLElement).dataset.bid === pbElement.dataset.bid) {
                pageVDiv = (pv as HTMLElement)
                break;
            }
          }

          // Se il divisore esiste modifichiamo l'altezza, altrimenti creiamo un nuovo divisore
          if (pageVDiv) {
            const minH = `${breakHeight}px`;
            pageVDiv.style.minHeight = minH;
          } else {
            // il divisore non esiste, lo creiamo
            view.dom.insertBefore(
              addTempBreakElement(pbElement.dataset.bid!, breakHeight),
              pbElement
            );            
          }

          // impostiamo alla fine dopo l'inserimento del pageVDiv
          storage.vdivs.set(pbElement.dataset.bid!, {
            type: 0,
            dir: -1,
            height: breakHeight,
            lastBottom: offsetBottom
          });
        }
        // storage.breaksToUpdate--;
        // index++;
      }

      // 4. Ripristiniamo il pageCount iniziale
      if (pageCount > existingPage) {
        for (let i = pageCount - 1; i >= existingPage; i--) {
          paginationElement.children[i].remove();
        }
      }
    }
  }
  return true // storage.breaksToUpdate <= 0;
};

const emptyPageBreakDefinition = (
  _pageHeight: number,
  _pageHeaderHeight: number,
  _pageGap: number,
  breakerWidth: number
) => {
  const pageContainer = document.createElement("div");
  pageContainer.classList.add("rm-page-break");

  const page = document.createElement("div");
  page.classList.add("page");
  page.style.position = "relative";
  page.style.float = "left";
  page.style.clear = "both";
  page.style.marginTop = _pageHeight + "px";

  const pageBreak = document.createElement("div");
  pageBreak.classList.add("breaker");
  pageBreak.style.width = `calc(${breakerWidth}px)`;
  pageBreak.style.marginLeft = `calc(calc(calc(${breakerWidth}px - 100%) / 2) - calc(${breakerWidth}px - 100%))`;
  pageBreak.style.marginRight = `calc(calc(calc(${breakerWidth}px - 100%) / 2) - calc(${breakerWidth}px - 100%))`;
  pageBreak.style.position = "relative";
  pageBreak.style.float = "left";
  pageBreak.style.clear = "both";
  pageBreak.style.left = "0px";
  pageBreak.style.right = "0px";
  pageBreak.style.zIndex = "2";

  const pageFooter = document.createElement("div");
  pageFooter.classList.add("rm-page-footer");
  pageFooter.style.height = _pageHeaderHeight + "px";

  const pageSpace = document.createElement("div");
  pageSpace.classList.add("rm-pagination-gap");
  pageSpace.style.height = _pageGap + "px";
  pageSpace.style.borderLeft = "1px solid";
  pageSpace.style.borderRight = "1px solid";
  pageSpace.style.position = "relative";
  pageSpace.style.setProperty("width", "calc(100% + 2px)", "important");
  pageSpace.style.left = "-1px";

  const pageHeader = document.createElement("div");
  pageHeader.classList.add("rm-page-header");
  pageHeader.style.height = _pageHeaderHeight + "px";

  pageBreak.append(pageFooter, pageSpace, pageHeader);
  pageContainer.append(page, pageBreak);

  return pageContainer;
};

function createDecoration(
  editor: Editor,
  state: EditorState,
  pageOptions: PaginationPlusOptions,
  isInitial: boolean = false
): Decoration[] {
  const pageWidget = Decoration.widget(
      0,
      (view) => {
        const _pageGap = pageOptions.pageGap;
        const _pageHeaderHeight = (pageOptions.pageHeaderHeight + pageOptions.contentMarginTop + pageOptions.marginTop);
        const _pageFooterHeight = (pageOptions.pageFooterHeight + pageOptions.contentMarginBottom + pageOptions.marginBottom);
        const _pageHeight = pageOptions.pageHeight - _pageHeaderHeight - _pageFooterHeight;
        const _pageBreakBackground = pageOptions.pageBreakBackground;
    
        const el = document.createElement("div");
        el.dataset.rmPagination = "true";
    
        const pageBreakDefinition = ({
          firstPage = false,
        }: {
          firstPage: boolean;
        }) => {
          const pageContainer = document.createElement("div");
          pageContainer.classList.add("rm-page-break");
    
          const page = document.createElement("div");
          page.classList.add("page");
          page.style.position = "relative";
          page.style.float = "left";
          page.style.clear = "both";
          page.style.marginTop = firstPage
            ? `calc(${_pageHeaderHeight}px + ${_pageHeight}px)`
            : _pageHeight + "px";
    
          const pageBreak = document.createElement("div");
          pageBreak.classList.add("breaker");
          pageBreak.style.width = `calc(100% + ${pageOptions.marginLeft}px + ${pageOptions.marginRight}px)`;
          pageBreak.style.marginLeft = `-${pageOptions.marginLeft}px`;
          pageBreak.style.marginRight = `-${pageOptions.marginRight}px`;
          pageBreak.style.position = "relative";
          pageBreak.style.float = "left";
          pageBreak.style.clear = "both";
          pageBreak.style.left = `0px`;
          pageBreak.style.right = `0px`;
          pageBreak.style.zIndex = "2";
    
          const pageFooter = document.createElement("div");
          pageFooter.classList.add("rm-page-footer");
          pageFooter.style.height = pageOptions.pageFooterHeight + "px";
          pageFooter.style.overflow = "hidden";
    
          const footerRight = pageOptions.footerRight.replace(
            "{page}",
            `<span class="rm-page-number"></span>`
          );
          const footerLeft = pageOptions.footerLeft.replace(
            "{page}",
            `<span class="rm-page-number"></span>`
          );
    
          const pageFooterLeft = document.createElement("div");
          pageFooterLeft.classList.add("rm-page-footer-left");
          pageFooterLeft.innerHTML = footerLeft;
    
          const pageFooterRight = document.createElement("div");
          pageFooterRight.classList.add("rm-page-footer-right");
          pageFooterRight.innerHTML = footerRight;
    
          pageFooter.append(pageFooterLeft);
          pageFooter.append(pageFooterRight);
    
    
          const pageSpace = document.createElement("div");
          pageSpace.classList.add("rm-pagination-gap");
          pageSpace.style.height = _pageGap + "px";
          pageSpace.style.borderLeft = "1px solid";
          pageSpace.style.borderRight = "1px solid";
          pageSpace.style.position = "relative";
          pageSpace.style.setProperty("width", "calc(100% + 2px)", "important");
          pageSpace.style.left = "-1px";
          pageSpace.style.backgroundColor = _pageBreakBackground;
          pageSpace.style.borderLeftColor = _pageBreakBackground;
          pageSpace.style.borderRightColor = _pageBreakBackground;
    
          const pageHeader = document.createElement("div");
          pageHeader.classList.add("rm-page-header");
          pageHeader.style.height = pageOptions.pageHeaderHeight + "px";
          pageHeader.style.overflow = "hidden";
    
          const pageHeaderLeft = document.createElement("div");
          pageHeaderLeft.classList.add("rm-page-header-left");
          pageHeaderLeft.innerHTML = pageOptions.headerLeft;
    
          const pageHeaderRight = document.createElement("div");
          pageHeaderRight.classList.add("rm-page-header-right");
          pageHeaderRight.innerHTML = pageOptions.headerRight;
    
          pageHeader.append(pageHeaderLeft, pageHeaderRight);
          pageBreak.append(pageFooter, pageSpace, pageHeader);
          pageContainer.append(page, pageBreak);
    
          return pageContainer;
        };
    
        const page = pageBreakDefinition({ firstPage: false });
        const firstPage = pageBreakDefinition({
          firstPage: true,
        });
        const fragment = document.createDocumentFragment();
    
        const pageCount = calculatePageCount(view, pageOptions);
    
        for (let i = 0; i < pageCount; i++) {
          if (i === 0) {
            fragment.appendChild(firstPage.cloneNode(true));
          } else {
            fragment.appendChild(page.cloneNode(true));
          }
        }
        el.append(fragment);
        el.id = "pages";
    
        return el;
      },
      { side: -1 }
    );
    const firstHeaderWidget = Decoration.widget(
      0,
      () => {
        const el = document.createElement("div");
        el.style.position = "relative";
        el.classList.add("rm-first-page-header");
  
        const pageHeaderLeft = document.createElement("div");
        pageHeaderLeft.classList.add("rm-first-page-header-left");
        pageHeaderLeft.innerHTML = pageOptions.headerLeft;
        el.append(pageHeaderLeft);
  
        const pageHeaderRight = document.createElement("div");
        pageHeaderRight.classList.add("rm-first-page-header-right");
        pageHeaderRight.innerHTML = pageOptions.headerRight;
        el.append(pageHeaderRight);
  
        el.style.height = `${pageOptions.pageHeaderHeight}px`;
        el.style.overflow = "hidden";
        return el;
      },
      { side: -1 }
    );
  
    return !isInitial ? [pageWidget, firstHeaderWidget] : [pageWidget];
}

function createDividerDecoration(
  editor: Editor,
  state: EditorState
): Decoration[] {
  const breaksDeco: Decoration[] = [];

  if (editor.storage.PaginationPlus.vdivs.size > 0) {
    state.doc.forEach((node, offset) => {
      if (node.type.name === "pb") {
        const curDiv = editor.storage.PaginationPlus.vdivs.get(
          node.attrs.bid
        );
        if (!curDiv) return true;
        const pageVDiv = document.createElement("div");
        pageVDiv.classList.add("vdiv-spacer");
        pageVDiv.style.width = "100%";
        pageVDiv.style.backgroundColor = node.attrs.type && node.attrs.type === "after" ? "blue" : "green";
        // pageVDiv.style.marginTop = (curBreak.height || 0) + "px";
        // pageVDiv.style.height = "1px";
        pageVDiv.style.height = (curDiv.height || 0) + "px";
        pageVDiv.dataset["bid"] = node.attrs.bid;
        // Insert a decoration immediately after this node
        const widget = Decoration.widget(
          curDiv.dir === -1 ? offset : offset + node.nodeSize,
          pageVDiv,
          { side: curDiv.dir }
        );

        // counter++;
        breaksDeco.push(widget);
      }
    });
  }

  return breaksDeco;
}