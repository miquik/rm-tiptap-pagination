import { Editor, Extension } from "@tiptap/core";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";

let debugCounter = 0

interface PaginationPlusOptions {
  pageHeight: number;
  pageWidth: number;
  pageGap: number;
  pageBreakBackground: string;
  pageHeaderHeight: number;
  pageGapBorderSize: number;
  pageMarginLeft: number;
  pageMarginRight: number;
  footerRight: string;
  footerLeft: string;
  headerRight: string;
  headerLeft: string;
}

interface PaginationPlusStorageOptions {
  breaksHaveChanged: boolean;
  breaksLastTop: number[]
  ignoreObserver: boolean
  lastStatePageGap: number
  accBreaksHeight: number
  breaks: Map<string, BreakInfo>
  breaksToUpdate: number
}

type PageInfo = {
  index: number;
  mt: number;
  // children index start
  cis: number;
  // children index end
  cie: number;
};

type BreakInfo = {
  type: number; // 0 = PAGEBREAK, 1 = FIGURE
  dir: number; // -1 = before, 1 = after
  height: number;
};

type DecoSets = {
  pageBreaks: DecorationSet; // es: page breaks
  pageCount: DecorationSet; // es: widgets
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

const pbsMustBeRecalculated = (
  pbs: NodeListOf<Element>,
  breaksLastTop: number[]
) => {
  // il numero di pbs è cambiato
  if (pbs.length != breaksLastTop.length) {
    return true;
  }
  // offsetTop di qualche pbs è cambiato
  let index = 0;
  for (const pb of pbs) {
    if ((pb as HTMLElement).offsetTop != breaksLastTop[index]) {
      return true;
    }
    index++;
  }

  // la struttura dei pbs non è più corretta (page-vdiv deve essere il vicino superiore o inferiore del pb)
  for (const pb of pbs) {
    if (
      pb.nextElementSibling?.classList.contains("page-vdiv") === false &&
      pb.previousElementSibling?.classList.contains("page-vdiv") === false
    ) {
      return true;
    }
  }

  return false;
};

let pauseObserver = false;

const page_count_meta_key = "PAGE_COUNT_META_KEY";
const page_breaks_meta_key = "PAGE_BREAKS_META_KEY";
export const PaginationPlusM22 = Extension.create<PaginationPlusOptions>({
  name: "PaginationPlus",
  addOptions() {
    return {
      pageHeight: 800,
      pageWidth: 790,
      pageGap: 50,
      pageGapBorderSize: 1,
      pageBreakBackground: "#ffffff",
      pageHeaderHeight: 10,
      pageMarginLeft: 57,
      pageMarginRight: 57,
      footerRight: "{page}",
      footerLeft: "",
      headerRight: "",
      headerLeft: "",
    };
  },
  addStorage() {
    return {
      breaksHaveChanged: false,
      breaksLastTop: [],
      ignoreObserver: false,
      lastStatePageGap: 0,
      accBreaksHeight: 0,
      breaks: new Map<string, BreakInfo>(),
      breaksToUpdate: 0,
    } as PaginationPlusStorageOptions;
  },
  onCreate() {
    const editorNode = this.editor.view.dom.parentElement;
    if (editorNode) {
      editorNode.style.width = `${this.options.pageWidth}px`;
      editorNode.style.marginLeft = "auto";
      editorNode.style.marginRight = "auto";
    }
    const targetNode = this.editor.view.dom;
    targetNode.classList.add("rm-with-pagination");
    const config = { attributes: true, subtree: true };
    const _pageHeaderHeight = this.options.pageHeaderHeight;
    const _pageHeight = this.options.pageHeight - _pageHeaderHeight * 2;

    const style = document.createElement("style");
    style.dataset.rmPaginationStyle = "";

    /*
    style.textContent = `
      .rm-with-pagination {
        padding-left: ${this.options.pageMarginLeft}px;
        padding-right: ${this.options.pageMarginRight}px;
      }
      .rm-with-pagination .rm-page-break.last-page ~ .rm-page-break {
        display: none;
      }
      .rm-with-pagination .rm-page-break.last-page .rm-pagination-gap {
        display: none;
      }
      .rm-with-pagination .rm-page-break.last-page .rm-page-header {
        display: none;
      }
      .rm-with-pagination p:has(br.ProseMirror-trailingBreak:only-child) {
        display: table;
        width: 100%;
      }
      .rm-with-pagination .table-row-group {
        max-height: ${this.options.pageHeight}px;
        overflow-y: auto;
        width: 100%;
      }
        
      .rm-first-page-header {
        background-color: hsl(var(--page-background));
      }

      .rm-page-header {
        background-color: hsl(var(--page-background));
      }

      .rm-page-footer {
        background-color: hsl(var(--page-background));
      }

      .rm-page-header-block {
          margin-left: ${this.options.pageMarginLeft}px !important;
          margin-right: ${this.options.pageMarginRight}px !important;
      }

      .rm-page-footer-block {
          margin-left: ${this.options.pageMarginLeft}px !important;
          margin-right: ${this.options.pageMarginRight}px !important;
       }
    `;
    */
    style.textContent = `
    .rm-with-pagination {
        padding-left: ${this.options.pageMarginLeft}px;
        padding-right: ${this.options.pageMarginRight}px;
      }
      .rm-with-pagination {
        counter-reset: page-number;
      }
      .rm-with-pagination .rm-page-footer {
        counter-increment: page-number;
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
        max-height: ${_pageHeight}px;
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
      .rm-with-pagination .rm-page-header-right{
        padding-top: 15px !important;
      }

      .rm-with-pagination .rm-page-header-left,
      .rm-with-pagination .rm-page-footer-left{
        float: left;
        margin-left: 25px;
      }
      .rm-with-pagination .rm-page-header-right,
      .rm-with-pagination .rm-page-footer-right{
        float: right;
        margin-right: 25px;
      }
      .rm-with-pagination .rm-page-number::before {
        content: counter(page-number);
      }
      .rm-with-pagination .rm-first-page-header{
        display: inline-flex;
        justify-content: space-between;
        width: 100%;
        padding-top: 15px !important;
      }
    `;

    document.head.appendChild(style);

    const marker = document.createElement("div");
    if (editorNode) {
      marker.setAttribute("data-pm-mutator", "0");
      marker.style.display = "none"; // invisibile
      editorNode.appendChild(marker);
    }

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
            pbsMustBeRecalculated(
              pbs,
              this.editor.storage.PaginationPlus.breaksLastTop
            )
          ) {
            // ricalcoliamo le altezze dei PBS
            pauseObserver = true;

            calculatePageBreaksHeight(
              this.editor.view,
              this.editor.storage,
              this.options
            );

            // abbiamo ricalcolato le altezze, adesso generiamo i nuovi DecorationSet
            const currentPageCount = getExistingPageCount(this.editor.view);
            const pageCount = calculatePageCount(
              this.editor.view,
              this.editor.storage,
              this.options
            );
            console.log('breaks: %d - exist: %d - calc: %d', debugCounter++, currentPageCount, pageCount)
            const tr = this.editor.view.state.tr.setMeta(
              page_breaks_meta_key,
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
              this.editor.storage,
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
        /*
        if (m.target) {
          const _target = m.target as HTMLElement;
          if (_target.classList.contains("rm-with-pagination")) {
            if (this.editor.storage.PaginationPlus.breaksToUpdate === 0) {
              refreshPage(_target);
              generalStore.set(debugAtom, {
                pages: {
                  total: parseFloat(this.editor.view.dom.style.minHeight),
                  guess: getExistingPageCount(this.editor.view),
                  calc:
                    parseFloat(this.editor.view.dom.style.minHeight) /
                    this.options.pageHeight,
                },
              });
            }
          }
        }

        if (m.attributeName === "data-pm-mutator") {
          if (this.editor.storage.PaginationPlus.breaksToUpdate > 0) {
            const complete = calculatePageBreaksHeight(
              this.editor.view,
              this.editor.storage,
              this.options
            );
            if (!complete) {
              // altri breaks da calcolare
              marker.setAttribute("data-pm-mutator", Date.now().toString());
            } else {
              refreshPage(targetNode);
            }
            const tr = this.editor.view.state.tr.setMeta(
              page_count_meta_key,
              Date.now()
            );
            this.editor.view.dispatch(tr);
          }
        }
        */
      }
    };
    const observer = new MutationObserver(callback);
    observer.observe(editorNode!, config);
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
            const widgeDivtList = createDividerDecoration(
                editor,
                state,
                pageOptions
              );
            return {
              pageBreaks: DecorationSet.create(state.doc, [...widgeDivtList]),
              pageCount: DecorationSet.create(state.doc, [...widgetList]),
            };
          },
          apply(tr, oldDeco, oldState, newState) {
            /*
            if (tr.docChanged) {
              const marker = document.querySelector("[data-pm-mutator]");
              if (marker) {
                const pbs = editor.view.dom.querySelectorAll("[data-break]");
                editor.storage.PaginationPlus.breaksToUpdate = pbs.length;
                marker.setAttribute("data-pm-mutator", Date.now().toString());
              }
            }
            */
            let { pageBreaks, pageCount } = oldDeco;
            if (tr.docChanged) {
              pageBreaks = pageBreaks.map(tr.mapping, tr.doc);
              pageCount = pageCount.map(tr.mapping, tr.doc);
            }

            if (tr.getMeta(page_breaks_meta_key)) {
              const widgetList = createDividerDecoration(
                editor,
                newState,
                pageOptions
              );
              pageBreaks = DecorationSet.create(newState.doc, [...widgetList]);
              // return DecorationSet.create(newState.doc, [...widgetList]);
            }

            if (tr.getMeta(page_count_meta_key)) {
              const widgetList = createDecoration(
                editor,
                newState,
                pageOptions
              );
              pageCount = DecorationSet.create(newState.doc, [...widgetList]);
              // return DecorationSet.create(newState.doc, [...widgetList]);
            }
            return { pageBreaks, pageCount };
          },
        },

        /*
        view(editorView) {
          return {
            update(view, prevState) {
              generalStore.set(debugAtom, {
                pages: {
                  total: parseFloat(view.dom.style.minHeight),
                  guess: getExistingPageCount(editor.view),
                  calc:
                    parseFloat(view.dom.style.minHeight) /
                    pageOptions.pageHeight,
                },
              });
            },
          };
        },
        */
        /*
        view(editorView) {
          // https://chatgpt.com/c/687fc44d-9a44-8329-a4d2-a71340df6a17
          const marker = document.createElement("div");
          marker.setAttribute("data-pm-mutator", "0");
          marker.style.display = "none"; // invisibile
          editorView.dom.parentElement?.appendChild(marker);

          return {
            update(view, prevState) {
              if (view.state.doc !== prevState.doc) {
                // Dobbiamo aggiornare i breaks
                // Quanti ce ne sono?
                const pbs = view.dom.querySelectorAll("[data-break]");
                editor.storage.PaginationPlus.breaksToUpdate = pbs.length;
                marker.setAttribute("data-pm-mutator", Date.now().toString());
              }
            },
            destroy() {
              marker.remove();
            },
          };
        },
        */

        props: {
          decorations(state: EditorState) {
            const s = this.getState(state);
            if (!s) return null;
            return mergeSets(state.doc, s.pageBreaks, s.pageCount);
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
  store: Record<string, unknown>,
  pageOptions: PaginationPlusOptions
) => {
  const editorDom = view.dom;
  // const pageVDivs = editorDom.querySelectorAll(".page-vdiv");
  // const cnt = pageVDivs.length;
  // pageVDivs.forEach(el => el.remove())
  // const storage = store.PaginationPlus;
  const pageContentAreaHeight =
    pageOptions.pageHeight - pageOptions.pageHeaderHeight * 2;
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
  pageVDiv.classList.add("page-vdiv");
  pageVDiv.style.width = "100%";
  pageVDiv.style.backgroundColor = "green";
  pageVDiv.style.height = (breakHeight || 0) + "px";
  pageVDiv.dataset["bid"] = bid;
  return pageVDiv;
}

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

function measureElement(
  ce: HTMLElement,
  parentOffset: number,
  scrollTop: number
) {
  const rect = ce.getBoundingClientRect();
  const styles = window.getComputedStyle(ce);
  const height = rect.height || 0;
  const marginTop = parseFloat(styles.marginTop) || 0;
  const marginBottom = parseFloat(styles.marginBottom) || 0;
  const borderTop = parseFloat(styles.borderTop) || 0;
  const borderBottom = parseFloat(styles.borderBottom) || 0;

  let elementHeight =
    height + marginTop + marginBottom + borderTop + borderBottom;
  // let elementOffsetTop = ce.offsetTop;
  let elementOffsetTop = rect.top + scrollTop - parentOffset;
  if (elementOffsetTop < 0) elementOffsetTop = 0;
  // const el2 = getTopWithMargin(ce, rect)
  if (styles.display === "contents") {
    // if (ce.tagName === "TABLE") {
    if (ce.children.length > 0) {
      elementOffsetTop = 0;
      elementHeight = 0;
      for (let i = 0; i < ce.children.length; i++) {
        const rect = ce.children[i].getBoundingClientRect();
        const styles = window.getComputedStyle(ce.children[i]);
        const height = rect.height || 0;
        const marginTop = parseFloat(styles.marginTop) || 0;
        const marginBottom = parseFloat(styles.marginBottom) || 0;
        const borderTop = parseFloat(styles.borderTop) || 0;
        const borderBottom = parseFloat(styles.borderBottom) || 0;
        if (i === 0) {
          // elementOffsetTop = (ce.children[i] as HTMLElement).offsetTop;
          elementOffsetTop =
            // getTopWithMargin(ce.children[i] as HTMLElement, rect) -
            rect.top + scrollTop - parentOffset;
          if (elementOffsetTop < 0) elementOffsetTop = 0;
        }
        elementHeight +=
          height + marginTop + marginBottom + borderTop + borderBottom;
      }
      return {
        rect: null,
        styles: null,
        height: elementHeight,
        offsetTop: elementOffsetTop,
      };
    }
  }
  return {
    rect,
    styles,
    height: elementHeight,
    offsetTop: elementOffsetTop,
  };
}

const calculatePageBreaksHeight = (
  view: EditorView,
  store: Record<string, unknown>,
  pageOptions: PaginationPlusOptions
) => {
  // L'idea è quella di modificare le altezze dei page-vdiv esistenti
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const storage = store.PaginationPlus as PaginationPlusStorageOptions
  const editorDom = view.dom;
  const parentOffset = editorDom.offsetTop;

  const headerFooterHeight =
    pageOptions.pageHeaderHeight * 2 + pageOptions.pageGap;

  const pageContentAreaHeight =
    pageOptions.pageHeight - pageOptions.pageHeaderHeight * 2;
  const paginationElement = editorDom.querySelector("[data-rm-pagination]");
  // const HEADING = editorDom.querySelector(".heading") as HTMLElement;

  if (paginationElement) {
    const existingPage = getExistingPageCount(view);

    const pbs = editorDom.querySelectorAll("[data-break]");
    if (pbs && pbs.length > 0) {
      // 1. Stimiamo una quantità di pagine che potrebbero risultare dopo l'algoritmo
      let pageCount = calculatePageCount(view, store, pageOptions);
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
      const pageVDivs = editorDom.querySelectorAll(".page-vdiv");

      /*
      let index = pbs.length - storage.breaksToUpdate;
      if (index < 0) {
        index = 0;
        storage.breaksToUpdate = pbs.length;
      }
      */
      let index = 0;
      for (const pb of pbs) {
        // const pbElement = pbs[index] as HTMLElement;
        const pbElement = pb as HTMLElement;
        // pbElement.style.marginTop = "0px";
        // const direction = pbElement.dataset.break === "after" ? 1 : -1;

        // N.B. l'idea è che il "blocco" pb + vdiv deve essere considerato come una singola identità
        // per non sbagliare i calcoli
        const height = pbElement.offsetHeight
        let offsetTop = pbElement.offsetTop
        if (
          pbElement.dataset.break === "before" &&
          (pbElement.previousElementSibling as HTMLElement).classList.contains("page-vdiv")
        ) {
          offsetTop = (pbElement.previousElementSibling as HTMLElement).offsetTop
        }
        
        if (pbElement.dataset.break === "after") {
          const dirOffsetTop = offsetTop + height;
          const pad = null;
          if (pad) {
            pbElement.style.marginTop = `${pad}px`;
          }

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

          if (breakHeight < 0) {
            breakHeight = 1;
          }

          storage.breaks.set(pbElement.dataset.bid!, {
            type: 0,
            dir: 1,
            height: breakHeight,
          });
          storage.breaksLastTop[index] = pbElement.offsetTop;

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

          
          if (breakHeight < 0) {
            breakHeight = 1;
          }

          storage.breaks.set(pbElement.dataset.bid!, {
            type: 0,
            dir: -1,
            height: breakHeight,
          });

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
          storage.breaksLastTop[index] = pbElement.offsetTop;
        }
        // storage.breaksToUpdate--;
        index++;
      }

      // 4. Ripristiniamo il pageCount iniziale
      if (pageCount > existingPage) {
        for (let i = pageCount - 1; i >= existingPage; i--) {
          paginationElement.children[i].remove();
        }
      }
    }
  }
  return storage.breaksToUpdate <= 0;
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
      const _pageHeaderHeight = pageOptions.pageHeaderHeight;
      const _pageHeight = pageOptions.pageHeight - _pageHeaderHeight * 2;
      const _pageBreakBackground = pageOptions.pageBreakBackground;

      const breakerWidth = view.dom.clientWidth;

      const el = document.createElement("div");
      el.dataset.rmPagination = "true";

      const pageBreakDefinition = ({
        firstPage = false,
        lastPage = false,
      }: {
        firstPage: boolean;
        lastPage: boolean;
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
        pageHeader.style.height = _pageHeaderHeight + "px";

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

      const page = pageBreakDefinition({ firstPage: false, lastPage: false });
      const firstPage = pageBreakDefinition({
        firstPage: true,
        lastPage: false,
      });
      const fragment = document.createDocumentFragment();

      const tempBreaks = view.dom.querySelectorAll(".rm-temp-break");
      tempBreaks.forEach((el) => el.remove());

      const pageCount = calculatePageCount(view, editor.storage, pageOptions);

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
      return el;
    },
    { side: -1 }
  );

  return !isInitial ? [pageWidget, firstHeaderWidget] : [pageWidget];
}

function createDividerDecoration(
  editor: Editor,
  state: EditorState,
  pageOptions: PaginationPlusOptions,
  isInitial: boolean = false
): Decoration[] {
  const breaksDeco: Decoration[] = [];

  if (editor.storage.PaginationPlus.breaks.size > 0) {
    state.doc.forEach((node, offset) => {
      if (node.type.name === "pb") {
        const curBreak = editor.storage.PaginationPlus.breaks.get(
          node.attrs.bid
        );
        if (!curBreak) return true;
        const pageVDiv = document.createElement("div");
        pageVDiv.classList.add("page-vdiv");
        pageVDiv.style.width = "100%";
        pageVDiv.style.backgroundColor = node.attrs.type && node.attrs.type === "after" ? "blue" : "green";
        // pageVDiv.style.marginTop = (curBreak.height || 0) + "px";
        // pageVDiv.style.height = "1px";
        pageVDiv.style.height = (curBreak.height || 0) + "px";
        pageVDiv.dataset["bid"] = node.attrs.bid;
        // Insert a decoration immediately after this node
        const widget = Decoration.widget(
          curBreak.dir === -1 ? offset : offset + node.nodeSize,
          pageVDiv,
          { side: curBreak.dir }
        );

        // counter++;
        breaksDeco.push(widget);
      }
    });
  }

  return breaksDeco;
}

/*
const calculatePageCount = (
  view: EditorView,
  store: Record<string, any>,
  pageOptions: PaginationPlusOptions
) => {
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const storage = store.PaginationPlus;
  const editorDom = view.dom;
  const parentOffset = editorDom.offsetTop;

  const pageContentAreaHeight =
    pageOptions.pageHeight - pageOptions.pageHeaderHeight * 2;
  const paginationElement = editorDom.querySelector("[data-rm-pagination]");
  const currentPageCount = getExistingPageCount(view);

  if (paginationElement) {
    const pbs = editorDom.querySelectorAll("[data-break]");
    if (pbs && pbs.length > 0) {
      // const tempDiv = editorDom.querySelectorAll(".page-vdiv");
      // tempDiv.forEach(el => el.remove())
      storage.accBreaksHeight = 0;

      const headerFooterHeight = 
        pageOptions.pageHeaderHeight * 2 + pageOptions.pageGap;

      if (pbs.length != storage.breaksLastPos.length) {
        // Dobbiamo aggiornare i breaks
        storage.breaksHaveChanged = true;
        storage.breaksLastPos = Array(pbs.length).fill(-1);
        storage.breaks.clear();
      }

      // pbs.forEach((pb, index) => {
      let index = 0;
      for (const pb of pbs) {
        const pbElement = pb as HTMLElement;
        const { offsetTop, height } = measureElement(
          pbElement,
          parentOffset,
          scrollTop
        );
        // const offsetTop = pbElement.offsetTop;
        if (offsetTop != storage.breaksLastPos[index]) {
          storage.breaksHaveChanged = true;
          storage.breaksLastPos[index] = offsetTop;

          const pi = getPagesInfo(
            offsetTop + storage.accBreaksHeight, // + borderTop,
            pageContentAreaHeight +
              pageOptions.pageHeaderHeight +
              headerFooterHeight,
            pageContentAreaHeight + headerFooterHeight
          );

          if (pbElement.dataset.break === "after") {
            const breakHeight =
              (pi.index === 0
                ? pageContentAreaHeight +
                  pageOptions.pageHeaderHeight +
                  0
                : pageContentAreaHeight + 0) -
              pi.mt -
              height;

            storage.breaks.set(pbElement.dataset.bid, {
              type: 0,
              dir: 1,
              height: breakHeight,
            });
            storage.accBreaksHeight += breakHeight;
            
            // if (pbElement.nextElementSibling) {
            //  view.dom.insertBefore(
            //    addTempBreakElement(breakHeight),
            //    pbElement.nextElementSibling
            //  );
            // } else {
            //   view.dom.append(addTempBreakElement(breakHeight));
            // }                          
          }
        }
        index++;
      }
    }

    const lastElementOfEditor = editorDom.lastElementChild;
    const lastPageBreak =
      paginationElement.lastElementChild?.querySelector(".breaker");
    if (lastElementOfEditor && lastPageBreak) {
      const lastPageGap =
        storage.accBreaksHeight +
        lastElementOfEditor.getBoundingClientRect().bottom -
        lastPageBreak.getBoundingClientRect().bottom;

      if (lastPageGap > 0) {
        const addPage = Math.ceil(lastPageGap / pageContentAreaHeight);
        return currentPageCount + addPage;
        // pageCalculated = currentPageCount + addPage;
      } else {
        const lpFrom = -pageOptions.pageHeaderHeight;
        const lpTo = -(pageOptions.pageHeight - pageOptions.pageHeaderHeight);
        if (lastPageGap > lpTo && lastPageGap < lpFrom) {
          return currentPageCount;
          // pageCalculated = currentPageCount;
        } else if (lastPageGap < lpTo) {
          const pageHeightOnRemove =
            pageOptions.pageHeight + pageOptions.pageGap;
          const removePage = Math.floor(lastPageGap / pageHeightOnRemove);
          return currentPageCount + removePage;
          // pageCalculated = currentPageCount + removePage;
        } else {
          return currentPageCount;
          // pageCalculated = currentPageCount;
        }
      }
    }
    return 1;
    // pageCalculated = 1;
  } else {
    const editorHeight = editorDom.scrollHeight;
    const pageCount = Math.ceil(editorHeight / pageContentAreaHeight);
    return pageCount <= 0 ? 1 : pageCount;
    /// pageCalculated = pageCount <= 0 ? 1 : pageCount;
  }
  // return pageCalculated;
};
*/
