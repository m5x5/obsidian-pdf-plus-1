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

    highlightLocation(child: PDFViewerChild, page: number, offset?: { left?: number; top?: number }, rect?: { left: number; bottom: number; right: number; top: number }): void {
        console.log('[PDFPlus ShiftHover] highlightLocation called:', {
            page,
            offset,
            rect,
            file: child.file?.path
        });

        this.clearHighlight();

        const pageView = child.getPage(page);
        if (!pageView) {
            console.warn('[PDFPlus ShiftHover] Page view not found');
            return;
        }

        const pageDiv = pageView.div;
        if (!pageDiv) {
            console.warn('[PDFPlus ShiftHover] Page div not found');
            return;
        }

        // Create a temporary highlight element at the location
        const highlightEl = pageDiv.createDiv('shift-hover-location-highlight');
        
        // Convert PDF coordinates to viewport coordinates
        // PDF coordinates are in PDF space (72 DPI), viewport coordinates are scaled
        const viewport = pageView.viewport;
        
        // If we have a rect, highlight that rectangle
        if (rect) {
            const topLeft = viewport.convertToViewportPoint(rect.left, rect.top);
            const bottomRight = viewport.convertToViewportPoint(rect.right, rect.bottom);
            
            const viewportLeft = topLeft[0];
            const viewportTop = topLeft[1];
            const viewportRight = bottomRight[0];
            const viewportBottom = bottomRight[1];
            
            // Account for page div borders and padding
            const style = pageDiv.win.getComputedStyle(pageDiv);
            const borderLeft = parseFloat(style.borderLeftWidth) || 0;
            const paddingLeft = parseFloat(style.paddingLeft) || 0;
            const borderTop = parseFloat(style.borderTopWidth) || 0;
            const paddingTop = parseFloat(style.paddingTop) || 0;
            
            const adjustedLeft = viewportLeft + borderLeft + paddingLeft;
            const adjustedTop = viewportTop + borderTop + paddingTop;
            const width = viewportRight - viewportLeft;
            const height = viewportBottom - viewportTop;
            
            console.log('[PDFPlus ShiftHover] Converted rect:', {
                pdfRect: rect,
                viewportRect: { left: viewportLeft, top: viewportTop, width, height },
                adjustments: { borderLeft, paddingLeft, borderTop, paddingTop },
                finalRect: { left: adjustedLeft, top: adjustedTop, width, height }
            });
            
            highlightEl.style.position = 'absolute';
            highlightEl.style.left = `${adjustedLeft}px`;
            highlightEl.style.top = `${adjustedTop}px`;
            highlightEl.style.width = `${width}px`;
            highlightEl.style.height = `${height}px`;
            highlightEl.style.pointerEvents = 'none';
        }
        // Otherwise, if we have an offset, show a point indicator
        else if (offset && offset.left !== undefined && offset.top !== undefined) {
            // Convert PDF point to viewport point
            const viewportPoint = viewport.convertToViewportPoint(offset.left, offset.top);
            const [viewportX, viewportY] = viewportPoint;
            
            // Account for page div borders and padding
            const style = pageDiv.win.getComputedStyle(pageDiv);
            const borderLeft = parseFloat(style.borderLeftWidth) || 0;
            const paddingLeft = parseFloat(style.paddingLeft) || 0;
            const borderTop = parseFloat(style.borderTopWidth) || 0;
            const paddingTop = parseFloat(style.paddingTop) || 0;
            
            const adjustedX = viewportX + borderLeft + paddingLeft;
            const adjustedY = viewportY + borderTop + paddingTop;
            
            console.log('[PDFPlus ShiftHover] Converted coordinates:', {
                pdfCoords: { x: offset.left, y: offset.top },
                viewportCoords: { x: viewportX, y: viewportY },
                adjustments: { borderLeft, paddingLeft, borderTop, paddingTop },
                finalCoords: { x: adjustedX, y: adjustedY }
            });
            
            // Create a circle at the exact location
            const size = 40; // size of the highlight indicator
            highlightEl.style.position = 'absolute';
            highlightEl.style.left = `${adjustedX}px`;
            highlightEl.style.top = `${adjustedY}px`;
            highlightEl.style.width = `${size}px`;
            highlightEl.style.height = `${size}px`;
            highlightEl.style.transform = 'translate(-50%, -50%)'; // Center on the point
            highlightEl.style.borderRadius = '50%'; // Make it a circle
            highlightEl.style.pointerEvents = 'none';
        } else if (offset && offset.top !== undefined) {
            // Convert just the top coordinate
            const viewportPoint = viewport.convertToViewportPoint(0, offset.top);
            const viewportY = viewportPoint[1];
            
            // Account for page div borders and padding
            const style = pageDiv.win.getComputedStyle(pageDiv);
            const borderTop = parseFloat(style.borderTopWidth) || 0;
            const paddingTop = parseFloat(style.paddingTop) || 0;
            
            const adjustedY = viewportY + borderTop + paddingTop;
            
            // Highlight a horizontal line at this vertical position
            highlightEl.style.position = 'absolute';
            highlightEl.style.left = '0';
            highlightEl.style.top = `${adjustedY}px`;
            highlightEl.style.width = '100%';
            highlightEl.style.height = '3px';
            highlightEl.style.pointerEvents = 'none';
        }

        this.currentHighlight = { element: highlightEl, child };
        console.log('[PDFPlus ShiftHover] Location highlight applied successfully');
    }

    clearHighlight(): void {
        if (this.currentHighlight) {
            console.log('[PDFPlus ShiftHover] Clearing highlight');
            this.currentHighlight.element.removeClass('shift-hover-target-highlight');
            this.currentHighlight.element.remove();
            this.currentHighlight = null;
        }
    }

    async resolveInternalLink(
        dest: string | any,
        doc: PDFDocumentProxy,
        sourceFile: TFile
    ): Promise<{ file: TFile; page: number; annotationId?: string; offset?: { left?: number; top?: number }; rect?: { left: number; bottom: number; right: number; top: number } } | null> {
        console.log('[PDFPlus ShiftHover] resolveInternalLink called:', { dest });
        try {
            // Use existing lib method to convert dest to subpath
            const subpath = await this.plugin.lib.pdfJsDestArrayToSubpath(dest, doc);
            console.log('[PDFPlus ShiftHover] Converted to subpath:', subpath);
            if (!subpath) {
                console.warn('[PDFPlus ShiftHover] No subpath returned');
                return null;
            }

            // Parse subpath: #page=5 or #page=5&annotation=123R or #page=5&offset=left,top,zoom or #page=5&rect=left,bottom,right,top
            const pageMatch = subpath.match(/#page=(\d+)/);
            const annotMatch = subpath.match(/annotation=([^&]+)/);
            const offsetMatch = subpath.match(/offset=([^&]+)/);
            const rectMatch = subpath.match(/rect=([^&]+)/);

            if (!pageMatch) {
                console.warn('[PDFPlus ShiftHover] Could not parse page from subpath');
                return null;
            }

            const page = parseInt(pageMatch[1], 10);
            const annotationId = annotMatch ? annotMatch[1] : undefined;

            // Parse offset: offset=left,top,zoom or offset=,top,
            let offset: { left?: number; top?: number } | undefined;
            if (offsetMatch) {
                const offsetParts = offsetMatch[1].split(',');
                const leftStr = offsetParts[0]?.trim();
                const topStr = offsetParts[1]?.trim();
                const left = leftStr && leftStr !== '' ? parseFloat(leftStr) : undefined;
                const top = topStr && topStr !== '' ? parseFloat(topStr) : undefined;
                if (left !== undefined && !isNaN(left) || top !== undefined && !isNaN(top)) {
                    offset = {};
                    if (left !== undefined && !isNaN(left)) offset.left = left;
                    if (top !== undefined && !isNaN(top)) offset.top = top;
                }
            }

            // Parse rect: rect=left,bottom,right,top
            let rect: { left: number; bottom: number; right: number; top: number } | undefined;
            if (rectMatch) {
                const rectParts = rectMatch[1].split(',').map(s => parseFloat(s.trim()));
                if (rectParts.length === 4 && rectParts.every(n => !isNaN(n))) {
                    rect = {
                        left: rectParts[0],
                        bottom: rectParts[1],
                        right: rectParts[2],
                        top: rectParts[3]
                    };
                }
            }

            console.log('[PDFPlus ShiftHover] Resolved internal link:', { page, annotationId, offset, rect });

            return { file: sourceFile, page, annotationId, offset, rect };
        } catch (err) {
            console.warn('[PDFPlus ShiftHover] Failed to resolve internal link:', err);
            return null;
        }
    }

    async resolveWikilink(
        url: string,
        sourceFile: TFile
    ): Promise<{ file: TFile; page: number; annotationId?: string; offset?: { left?: number; top?: number }; rect?: { left: number; bottom: number; right: number; top: number } } | null> {
        console.log('[PDFPlus ShiftHover] resolveWikilink called:', { url });
        try {
            // Remove [[ and ]] brackets (or ![[  and ]] for embeds)
            const isEmbed = url.startsWith('![[');
            const startSlice = isEmbed ? 3 : 2;
            const linktext = url.slice(startSlice, -2);
            console.log('[PDFPlus ShiftHover] Extracted linktext:', { linktext, isEmbed });

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
            const offsetMatch = subpath.match(/offset=([^&]+)/);
            const rectMatch = subpath.match(/rect=([^&]+)/);

            const page = pageMatch ? parseInt(pageMatch[1], 10) : 1;
            const annotationId = annotMatch ? annotMatch[1] : undefined;
            
            // Parse offset: offset=left,top,zoom or offset=,top,
            let offset: { left?: number; top?: number } | undefined;
            if (offsetMatch) {
                const offsetParts = offsetMatch[1].split(',');
                const leftStr = offsetParts[0]?.trim();
                const topStr = offsetParts[1]?.trim();
                const left = leftStr && leftStr !== '' ? parseFloat(leftStr) : undefined;
                const top = topStr && topStr !== '' ? parseFloat(topStr) : undefined;
                if (left !== undefined && !isNaN(left) || top !== undefined && !isNaN(top)) {
                    offset = {};
                    if (left !== undefined && !isNaN(left)) offset.left = left;
                    if (top !== undefined && !isNaN(top)) offset.top = top;
                }
            }

            // Parse rect: rect=left,bottom,right,top
            let rect: { left: number; bottom: number; right: number; top: number } | undefined;
            if (rectMatch) {
                const rectParts = rectMatch[1].split(',').map(s => parseFloat(s.trim()));
                if (rectParts.length === 4 && rectParts.every(n => !isNaN(n))) {
                    rect = {
                        left: rectParts[0],
                        bottom: rectParts[1],
                        right: rectParts[2],
                        top: rectParts[3]
                    };
                }
            }

            console.log('[PDFPlus ShiftHover] Resolved wikilink:', { page, annotationId, offset, rect });

            return { file, page, annotationId, offset, rect };
        } catch (err) {
            console.warn('[PDFPlus ShiftHover] Failed to resolve wikilink:', err);
            return null;
        }
    }

    /**
     * Find the closest annotation to a given offset coordinate on a page
     */
    async findClosestAnnotationToOffset(
        child: PDFViewerChild,
        page: number,
        offset: { left?: number; top?: number }
    ): Promise<string | null> {
        console.log('[PDFPlus ShiftHover] findClosestAnnotationToOffset called:', { page, offset });

        const pageView = child.getPage(page);
        if (!pageView) {
            console.warn('[PDFPlus ShiftHover] Page view not found');
            return null;
        }

        // Get all annotations from the page
        const annotations = await pageView.pdfPage.getAnnotations();
        console.log('[PDFPlus ShiftHover] Found annotations:', annotations.length);
        
        // Log annotation types for debugging
        const annotationTypes = annotations.map(a => ({ id: a.id, subtype: a.subtype }));
        console.log('[PDFPlus ShiftHover] Annotation types:', annotationTypes);

        if (annotations.length === 0) {
            console.log('[PDFPlus ShiftHover] No annotations found on page');
            return null;
        }

        // Text markup annotations (highlights, underlines) are preferred over other types
        const textMarkupSubtypes = ['Highlight', 'Underline', 'Squiggly', 'StrikeOut'];
        
        // Calculate distance to each annotation and find the closest one
        // We'll collect candidates and then prioritize text markup annotations
        const candidates: Array<{ id: string; distance: number; isTextMarkup: boolean; containsPoint: boolean; subtype: string }> = [];
        const textAnnotationCandidates: Array<{ id: string; distance: number; containsPoint: boolean }> = [];

        for (const annot of annotations) {
            if (!annot.rect || !Array.isArray(annot.rect) || annot.rect.length < 4) {
                continue;
            }

            const isTextMarkup = textMarkupSubtypes.includes(annot.subtype);
            const [left, bottom, right, top] = annot.rect;
            const centerX = (left + right) / 2;
            const centerY = (top + bottom) / 2;

            // Calculate distance from offset to annotation center
            let distance = Infinity;
            let containsPoint = false;
            
            if (offset.left !== undefined && offset.top !== undefined) {
                // Check if point is inside annotation
                if (offset.left >= left && offset.left <= right && 
                    offset.top >= bottom && offset.top <= top) {
                    containsPoint = true;
                    distance = 0;
                } else {
                    // Use Euclidean distance
                    const dx = offset.left - centerX;
                    const dy = offset.top - centerY;
                    distance = Math.sqrt(dx * dx + dy * dy);
                }
            } else if (offset.top !== undefined) {
                // If only top is specified, use vertical distance
                distance = Math.abs(offset.top - centerY);
            } else if (offset.left !== undefined) {
                // If only left is specified, use horizontal distance
                distance = Math.abs(offset.left - centerX);
            }

            // Separate Text annotations - we'll use them as fallback if no other annotations found
            if (annot.subtype === 'Text') {
                textAnnotationCandidates.push({ id: annot.id, distance, containsPoint });
                continue;
            }

            candidates.push({ id: annot.id, distance, isTextMarkup, containsPoint, subtype: annot.subtype });
        }

        // If no non-Text annotations found, use Text annotations as fallback
        if (candidates.length === 0) {
            console.log('[PDFPlus ShiftHover] No non-Text annotations found, using Text annotations as fallback');
            if (textAnnotationCandidates.length === 0) {
                console.log('[PDFPlus ShiftHover] No valid annotations found');
                return null;
            }
            // Sort text annotations by containsPoint first, then distance
            textAnnotationCandidates.sort((a, b) => {
                if (a.containsPoint !== b.containsPoint) {
                    return a.containsPoint ? -1 : 1;
                }
                return a.distance - b.distance;
            });
            const closest = textAnnotationCandidates[0];
            console.log('[PDFPlus ShiftHover] Closest Text annotation (fallback):', { 
                id: closest.id, 
                distance: closest.distance,
                containsPoint: closest.containsPoint
            });
            return closest.id;
        }

        // Sort candidates: prioritize annotations that contain the point, then text markup annotations, then by distance
        candidates.sort((a, b) => {
            // First: annotations that contain the point
            if (a.containsPoint !== b.containsPoint) {
                return a.containsPoint ? -1 : 1;
            }
            // Second: text markup annotations
            if (a.isTextMarkup !== b.isTextMarkup) {
                return a.isTextMarkup ? -1 : 1;
            }
            // Third: by distance
            return a.distance - b.distance;
        });

        const closest = candidates[0];
        console.log('[PDFPlus ShiftHover] Closest annotation:', { 
            id: closest.id, 
            distance: closest.distance, 
            isTextMarkup: closest.isTextMarkup,
            containsPoint: closest.containsPoint
        });
        
        return closest.id;

        console.log('[PDFPlus ShiftHover] Closest annotation:', { id: closestId, distance: minDistance });
        return closestId;
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
