import { Component, TFile } from 'obsidian';

import PDFPlus from 'main';
import { PDFViewerChild } from 'typings';
import type { PDFDocumentProxy } from 'pdfjs-dist';


export class ShiftHoverManager extends Component {
    plugin: PDFPlus;
    private isShiftPressed = false;
    private currentHighlight: {
        element: HTMLElement;
        child: PDFViewerChild;
    } | null = null;

    constructor(plugin: PDFPlus) {
        super();
        this.plugin = plugin;
    }

    get app() {
        return this.plugin.app;
    }

    onload() {
        console.log('[PDFPlus ShiftHover] ShiftHoverManager onload()');
        // Global shift key listeners
        this.registerDomEvent(document, 'keydown', (evt) => {
            if (evt.key === 'Shift' && !this.isShiftPressed) {
                this.isShiftPressed = true;
                console.log('[PDFPlus ShiftHover] Shift key pressed - shift mode ACTIVE');
            }
        });

        this.registerDomEvent(document, 'keyup', (evt) => {
            if (evt.key === 'Shift') {
                this.isShiftPressed = false;
                console.log('[PDFPlus ShiftHover] Shift key released - shift mode INACTIVE');
                this.clearHighlight();
            }
        });
    }

    isActive(): boolean {
        return this.isShiftPressed;
    }

    highlightAnnotation(child: PDFViewerChild, page: number, annotationId: string): void {
        console.log('[PDFPlus ShiftHover] highlightAnnotation called:', {
            page,
            annotationId,
            file: child.file?.path
        });

        this.clearHighlight();

        const pageView = child.getPage(page);
        console.log('[PDFPlus ShiftHover] pageView:', !!pageView);

        const annotLayerDiv = pageView?.annotationLayer?.div;
        console.log('[PDFPlus ShiftHover] annotLayerDiv:', !!annotLayerDiv);

        if (!annotLayerDiv) {
            console.warn('[PDFPlus ShiftHover] No annotation layer div found');
            return;
        }

        const element = annotLayerDiv.querySelector<HTMLElement>(
            `[data-annotation-id="${annotationId}"]`
        );
        console.log('[PDFPlus ShiftHover] Found annotation element:', !!element);

        if (element) {
            console.log('[PDFPlus ShiftHover] Adding highlight class to element');
            element.addClass('shift-hover-target-highlight');
            this.currentHighlight = { element, child };
            console.log('[PDFPlus ShiftHover] Highlight applied successfully');
        } else {
            console.warn('[PDFPlus ShiftHover] Could not find annotation element with ID:', annotationId);
        }
    }

    clearHighlight(): void {
        if (this.currentHighlight) {
            console.log('[PDFPlus ShiftHover] Clearing highlight');
            this.currentHighlight.element.removeClass('shift-hover-target-highlight');
            this.currentHighlight = null;
        }
    }

    async resolveInternalLink(
        dest: string | any,
        doc: PDFDocumentProxy,
        sourceFile: TFile
    ): Promise<{ file: TFile; page: number; annotationId?: string } | null> {
        console.log('[PDFPlus ShiftHover] resolveInternalLink called:', { dest });
        try {
            // Use existing lib method to convert dest to subpath
            const subpath = await this.plugin.lib.pdfJsDestArrayToSubpath(dest, doc);
            console.log('[PDFPlus ShiftHover] Converted to subpath:', subpath);
            if (!subpath) {
                console.warn('[PDFPlus ShiftHover] No subpath returned');
                return null;
            }

            // Parse subpath: #page=5 or #page=5&annotation=123R
            const match = subpath.match(/#page=(\d+)(?:&annotation=([^&]+))?/);
            console.log('[PDFPlus ShiftHover] Subpath match:', match);
            if (!match) {
                console.warn('[PDFPlus ShiftHover] Could not parse subpath');
                return null;
            }

            const page = parseInt(match[1], 10);
            const annotationId = match[2];
            console.log('[PDFPlus ShiftHover] Resolved internal link:', { page, annotationId });

            return { file: sourceFile, page, annotationId };
        } catch (err) {
            console.warn('[PDFPlus ShiftHover] Failed to resolve internal link:', err);
            return null;
        }
    }

    async resolveWikilink(
        url: string,
        sourceFile: TFile
    ): Promise<{ file: TFile; page: number; annotationId?: string } | null> {
        console.log('[PDFPlus ShiftHover] resolveWikilink called:', { url });
        try {
            // Remove [[ and ]] brackets
            const linktext = url.slice(2, -2);
            console.log('[PDFPlus ShiftHover] Extracted linktext:', linktext);

            // Split into path and subpath
            const hashIndex = linktext.indexOf('#');
            const filePath = hashIndex > 0 ? linktext.slice(0, hashIndex) : linktext;
            const subpath = hashIndex > 0 ? linktext.slice(hashIndex) : '';
            console.log('[PDFPlus ShiftHover] Parsed:', { filePath, subpath });

            // Resolve file
            const file = this.app.metadataCache.getFirstLinkpathDest(
                filePath,
                sourceFile.path
            );
            console.log('[PDFPlus ShiftHover] Resolved file:', file?.path);
            if (!file) {
                console.warn('[PDFPlus ShiftHover] Could not resolve wikilink file');
                return null;
            }

            // Parse subpath
            const pageMatch = subpath.match(/page=(\d+)/);
            const annotMatch = subpath.match(/annotation=([^&]+)/);

            const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;
            const annotationId = annotMatch ? annotMatch[1] : undefined;
            console.log('[PDFPlus ShiftHover] Resolved wikilink:', { page, annotationId });

            return { file, page, annotationId };
        } catch (err) {
            console.warn('[PDFPlus ShiftHover] Failed to resolve wikilink:', err);
            return null;
        }
    }

    findViewerForFile(targetFile: TFile): PDFViewerChild | null {
        console.log('[PDFPlus ShiftHover] findViewerForFile:', targetFile.path);
        let targetChild: PDFViewerChild | null = null;

        this.plugin.lib.workspace.iteratePDFViewerChild((child) => {
            console.log('[PDFPlus ShiftHover] Checking child with file:', child.file?.path);
            if (!targetChild && child.file?.path === targetFile.path) {
                targetChild = child;
                console.log('[PDFPlus ShiftHover] Found matching viewer');
            }
        });

        if (!targetChild) {
            console.warn('[PDFPlus ShiftHover] No viewer found for file:', targetFile.path);
        }

        return targetChild;
    }
}
