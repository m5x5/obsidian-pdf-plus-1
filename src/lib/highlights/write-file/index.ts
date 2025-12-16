import { Notice, TFile} from 'obsidian';

import PDFPlus from 'main';
import { PdfLibIO } from './pdf-lib';
import { PDFPlusLibSubmodule } from 'lib/submodule';
import { getTextLayerInfo } from 'utils';
import { DestArray, PDFViewerChild, Rect } from 'typings';
import { PDFExternalLinkPostProcessor } from 'post-process/external-link';


export type TextMarkupAnnotationSubtype = 'Highlight' | 'Underline' | 'Squiggly' | 'StrikeOut';

export class AnnotationWriteFileLib extends PDFPlusLibSubmodule {
    pdflib: PdfLibIO;

    constructor(plugin: PDFPlus) {
        super(plugin);
        this.pdflib = new PdfLibIO(plugin);
    }

    private getPdfIo(): IPdfIo {
        return this.pdflib;
    }

    async addTextMarkupAnnotationToSelection(subtype: TextMarkupAnnotationSubtype, colorName?: string) {
        return this.addAnnotationToSelection(async (file, page, rects) => {
            const io = this.getPdfIo();
            return await io.addTextMarkupAnnotation(file, page, rects, subtype, colorName);
        });
    }

    /**
     * Register the post-processor for a newly created link annotation with a wikilink.
     * 
     * Note: When the PDF file is saved, Obsidian automatically reloads the PDF viewer.
     * The `annotationlayerrendered` event handler in pdf-internals.ts will automatically
     * register the post-processor when the annotation layer is re-rendered after the reload.
     * 
     * However, we also try to register it immediately on the current annotation layer
     * (if it exists) as a fallback, though this is unlikely to work since the annotation
     * won't exist in the DOM until after the reload.
     */
    private async registerPostProcessorForNewAnnotation(child: PDFViewerChild, pageNumber: number, annotationID: string | undefined, dest: DestArray | string) {
        // Only register for string destinations that look like wikilinks
        if (!annotationID || typeof dest !== 'string') return;
        if (!dest.startsWith('[[')) return;

        console.log('[PDFPlus] Annotation created with wikilink - attempting to register post-processor', {
            annotationID,
            dest,
            pageNumber
        });

        // Try to register immediately on the current annotation layer (before reload)
        // This is unlikely to work since the annotation won't be in the DOM yet,
        // but it's harmless to try
        const pageView = child.getPage(pageNumber);
        if (pageView?.annotationLayer?.div) {
            const annot = pageView.annotationLayer.annotationLayer.getAnnotation(annotationID);
            if (annot && annot.container.dataset.pdfPlusIsAnnotationPostProcessed !== 'true') {
                console.log('[PDFPlus] Found annotation in current layer, registering post-processor immediately');
                PDFExternalLinkPostProcessor.registerEvents(this.plugin, child, annot);
                return;
            }
        }

        // If not found, the annotationlayerrendered event will handle it after the reload
        console.log('[PDFPlus] Annotation not found in current layer - will be registered automatically when annotation layer renders after reload');
    }

    /**
     * @param dest A destination, represented either by its name (named destination) or as a DestArray (explicit destination).
     */
    async addLinkAnnotationToSelection(dest: DestArray | string, contents?: string) {
        console.log('[PDFPlus] addLinkAnnotationToSelection called', { dest, contents });
        const result = await this.addAnnotationToSelection(async (file, page, rects) => {
            console.log('[PDFPlus] Annotator callback called', { file: file.path, page, rectsCount: rects.length });
            const io = this.getPdfIo();
            const annotationID = await io.addLinkAnnotation(file, page, rects, dest, undefined, contents);
            console.log('[PDFPlus] Link annotation added, ID:', annotationID);
            return annotationID;
        });
        console.log('[PDFPlus] addLinkAnnotationToSelection result:', result);
        
        // Register post-processor for wikilink annotations
        if (result && result.child && result.annotationID) {
            await this.registerPostProcessorForNewAnnotation(result.child, result.page, result.annotationID, dest);
        }
        
        return result;
    }

    async addLinkAnnotation(file: TFile, pageNumber: number, rects: Rect[], dest: DestArray | string, colorName?: string, contents?: string) {
        console.log('[PDFPlus] addLinkAnnotation called', { file: file.path, pageNumber, rects, dest, colorName, contents });
        const io = this.getPdfIo();
        const annotationID = await io.addLinkAnnotation(file, pageNumber, rects, dest, colorName, contents);

        // Register post-processor for wikilink annotations
        // Find the child associated with this file
        let child: PDFViewerChild | null = null;
        this.lib.workspace.iteratePDFViewerChild((c) => {
            if (!child && c.file?.path === file.path) {
                child = c;
            }
        });

        if (child && annotationID) {
            await this.registerPostProcessorForNewAnnotation(child, pageNumber, annotationID, dest);
        }

        return annotationID;
    }

    /**
     * Add a sticky note (Text annotation) at a specific position on the PDF page.
     * @param child The PDF viewer child
     * @param pageNumber The page number (1-based)
     * @param screenX Screen X coordinate from click event
     * @param screenY Screen Y coordinate from click event
     * @param contents The note content (markdown supported)
     * @param colorName Optional color name from palette
     * @returns The annotation ID if successful, undefined otherwise
     */
    async addStickyNoteAtPosition(
        child: PDFViewerChild,
        pageNumber: number,
        screenX: number,
        screenY: number,
        contents: string,
        colorName?: string
    ): Promise<string | undefined> {
        if (!child.file) return undefined;

        const pageView = child.getPage(pageNumber);
        if (!pageView) return undefined;

        // Convert screen coordinates to PDF coordinates
        const pageEl = pageView.div;
        const pageRect = pageEl.getBoundingClientRect();
        const style = getComputedStyle(pageEl);
        const borderLeft = parseFloat(style.borderLeftWidth) || 0;
        const borderTop = parseFloat(style.borderTopWidth) || 0;
        const paddingLeft = parseFloat(style.paddingLeft) || 0;
        const paddingTop = parseFloat(style.paddingTop) || 0;

        const relativeX = screenX - (pageRect.left + borderLeft + paddingLeft);
        const relativeY = screenY - (pageRect.top + borderTop + paddingTop);

        // Convert to PDF coordinates using pageView.getPagePoint
        const [pdfX, pdfY] = pageView.getPagePoint(relativeX, relativeY);

        const io = this.getPdfIo();
        try {
            const annotationID = await io.addTextAnnotation(
                child.file,
                pageNumber,
                pdfX,
                pdfY,
                contents,
                colorName
            );
            return annotationID;
        } catch (e) {
            new Notice(`${this.plugin.manifest.name}: Failed to add sticky note.`);
            console.error(e);
            return undefined;
        }
    }

    /**
     * Add a link annotation using preserved selection info (useful when selection is lost due to modal focus).
     * @param child The PDF viewer child
     * @param pageNumber The page number (1-based)
     * @param selectionInfo The preserved selection range info
     * @param dest The link destination (either DestArray, wikilink string, or path/subpath object)
     * @param contents Optional description/contents
     */
    async addLinkAnnotationToTextRange(child: PDFViewerChild, pageNumber: number, selectionInfo: { beginIndex: number, beginOffset: number, endIndex: number, endOffset: number }, dest: DestArray | string | {path: string, subpath: string}, contents?: string) {
        console.log('[PDFPlus] addLinkAnnotationToTextRange called with preserved selection', {
            file: child.file?.path,
            pageNumber,
            selectionInfo
        });
        
        if (!child.file) {
            console.log('[PDFPlus] No file on child');
            return null;
        }

        // Convert path/subpath object to wikilink string if needed
        let destString: DestArray | string;
        if (typeof dest === 'object' && 'path' in dest && 'subpath' in dest && !Array.isArray(dest)) {
            // Convert to wikilink format: [[path#subpath]]
            destString = `[[${dest.path}${dest.subpath}]]`;
        } else {
            destString = dest as DestArray | string;
        }

        const result = await this.addAnnotationToTextRange(async (file, page, rects) => {
            console.log('[PDFPlus] Annotator callback for preserved selection', { file: file.path, page, rectsCount: rects.length });
            const io = this.getPdfIo();
            const annotationID = await io.addLinkAnnotation(file, page, rects, destString, undefined, contents);
            console.log('[PDFPlus] Link annotation added with preserved selection, ID:', annotationID);
            return annotationID;
        }, child, pageNumber, selectionInfo.beginIndex, selectionInfo.beginOffset, selectionInfo.endIndex, selectionInfo.endOffset);
        
        // Register post-processor for wikilink annotations
        if (result && result.annotationID) {
            await this.registerPostProcessorForNewAnnotation(child, pageNumber, result.annotationID, destString);
        }
        
        return result;
    }

    async addAnnotationToSelection(annotator: Annotator) {
        console.log('[PDFPlus] addAnnotationToSelection called');
        const windowSelection = activeWindow.getSelection();
        console.log('[PDFPlus] Window selection:', {
            exists: !!windowSelection,
            isCollapsed: windowSelection?.isCollapsed,
            toString: windowSelection?.toString(),
            rangeCount: windowSelection?.rangeCount
        });
        
        if (!windowSelection) {
            console.log('[PDFPlus] No window selection found, returning null');
            return null;
        }

        const pageAndSelection = this.lib.copyLink.getPageAndTextRangeFromSelection(windowSelection);
        console.log('[PDFPlus] Page and selection:', {
            exists: !!pageAndSelection,
            page: pageAndSelection?.page,
            hasSelection: !!pageAndSelection?.selection,
            selection: pageAndSelection?.selection
        });
        
        if (!pageAndSelection || !pageAndSelection.selection) {
            console.log('[PDFPlus] No pageAndSelection or selection, returning null');
            return null;
        }

        const { page, selection: { beginIndex, beginOffset, endIndex, endOffset } } = pageAndSelection;
        console.log('[PDFPlus] Extracted selection info:', { page, beginIndex, beginOffset, endIndex, endOffset });

        const child = this.lib.getPDFViewerChildFromSelection(windowSelection);
        console.log('[PDFPlus] PDF viewer child:', {
            exists: !!child,
            file: child?.file?.path
        });
        
        if (!child) {
            console.log('[PDFPlus] No PDF viewer child found, returning null');
            return null;
        }

        const textRangeResult = await this.addAnnotationToTextRange(annotator, child, page, beginIndex, beginOffset, endIndex, endOffset);
        console.log('[PDFPlus] addAnnotationToTextRange result:', textRangeResult);
        
        return {
            child,
            file: child.file,
            page,
            ...textRangeResult
        };
    }

    /** Add a highlight annotation to a text selection specified by a subpath of the form `#page=<pageNumber>&selection=<beginIndex>,<beginOffset>,<endIndex>,<endOffset>`. */
    async addAnnotationToTextRange(annotator: Annotator, child: PDFViewerChild, pageNumber: number, beginIndex: number, beginOffset: number, endIndex: number, endOffset: number) {
        console.log('[PDFPlus] addAnnotationToTextRange called', {
            file: child.file?.path,
            pageNumber,
            pagesCount: child.pdfViewer.pagesCount,
            beginIndex,
            beginOffset,
            endIndex,
            endOffset
        });
        
        if (!child.file) {
            console.log('[PDFPlus] No file on child, returning undefined');
            return;
        }

        if (1 <= pageNumber && pageNumber <= child.pdfViewer.pagesCount) {
            const pageView = child.getPage(pageNumber);
            console.log('[PDFPlus] Page view:', {
                exists: !!pageView,
                hasTextLayer: !!pageView?.textLayer,
                isLoaded: pageView?.div.dataset.loaded === 'true'
            });
            
            if (pageView?.textLayer && pageView.div.dataset.loaded) {
                const textLayerInfo = getTextLayerInfo(pageView.textLayer);
                console.log('[PDFPlus] Text layer info:', {
                    exists: !!textLayerInfo,
                    itemsCount: textLayerInfo?.textContentItems?.length
                });
                
                if (textLayerInfo) {
                    const results = this.lib.highlight.geometry.computeMergedHighlightRects(textLayerInfo, beginIndex, beginOffset, endIndex, endOffset);
                    const rects = results.map(({ rect }) => rect);
                    console.log('[PDFPlus] Computed rects:', { count: rects.length, rects });
                    
                    let annotationID;
                    try {
                        annotationID = await annotator(child.file, pageNumber, rects);
                        console.log('[PDFPlus] Annotation created successfully, ID:', annotationID);
                    } catch (e) {
                        console.error('[PDFPlus] Error creating annotation:', e);
                        new Notice(`${this.plugin.manifest.name}: An error occurred while attemping to add an annotation.`);
                        console.error(e);
                    }
                    return { annotationID, rects };
                } else {
                    console.log('[PDFPlus] No textLayerInfo found');
                }
            } else {
                console.log('[PDFPlus] Page view conditions not met - textLayer:', !!pageView?.textLayer, 'loaded:', pageView?.div.dataset.loaded);
            }
        } else {
            console.log('[PDFPlus] Page number out of range:', pageNumber, 'not in [1,', child.pdfViewer.pagesCount, ']');
        }
    }

    async deleteAnnotation(file: TFile, pageNumber: number, id: string) {
        const io = this.getPdfIo();
        await io.deleteAnnotation(file, pageNumber, id);
    }

    async getAnnotationContents(file: TFile, pageNumber: number, id: string) {
        const io = this.getPdfIo();
        return await io.getAnnotationContents(file, pageNumber, id);
    }

    async setAnnotationContents(file: TFile, pageNumber: number, id: string, contents: string) {
        const io = this.getPdfIo();
        return await io.setAnnotationContents(file, pageNumber, id, contents);
    }
}

export interface IPdfIo {
    /**
     * @param pageNumber A 1-based page number.
     * @returns A promise resolving to the ID of the newly created annotation. The annotation must be a highlight annotation
     * containing the given rectangles "grouped" using quadpoints.
     */
    addHighlightAnnotation(file: TFile, pageNumber: number, rects: Rect[], colorName?: string, contents?: string): Promise<string>;
    addTextMarkupAnnotation(file: TFile, pageNumber: number, rects: Rect[], subtype: 'Highlight' | 'Underline' | 'Squiggly' | 'StrikeOut', colorName?: string, contents?: string): Promise<string>
    addLinkAnnotation(file: TFile, pageNumber: number, rects: Rect[], dest: DestArray | string, colorName?: string, contents?: string): Promise<string>;
    addTextAnnotation(file: TFile, pageNumber: number, x: number, y: number, contents: string, colorName?: string): Promise<string>;
    deleteAnnotation(file: TFile, pageNumber: number, id: string): Promise<void>;
    getAnnotationContents(file: TFile, pageNumber: number, id: string): Promise<string | null>;
    setAnnotationContents(file: TFile, pageNumber: number, id: string, contents: string): Promise<void>;
}

/**
 * @returns A promise resolving to the ID of the newly created annotation. The annotation must be a highlight annotation 
 * containing the given rectangles "grouped" using quadpoints.
 */
export type Annotator = (file: TFile, page: number, rects: Rect[]) => Promise<string>;
