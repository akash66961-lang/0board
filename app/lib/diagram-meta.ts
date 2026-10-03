/**
 * Custom properties Fabric must persist through toJSON (page save, undo/redo).
 * Keep this list in sync with the `DiagramMeta` interface below.
 */
export const CUSTOM_PROPS: string[] = [
	"arrowId",
	"handleFor",
	"arrowRole",
	"pointIndex",
	"isSticky",
	"stickyPart",
];

/**
 * Fabric objects are typed by their own class; the diagram layer bolts extra
 * linking data onto them. These helpers keep the casts in one place instead of
 * scattering `as unknown as Record<string, unknown>` across the codebase.
 */
export interface DiagramMeta {
	/** Groups every part of one arrow together. */
	arrowId?: string;
	/** Marks a legacy drag handle that belongs to the given arrow. */
	handleFor?: string;
	/**
	 * `shaft1`/`shaft2` are from the previous two-segment arrow format and only
	 * exist in saved pages that predate the current three-point arrows.
	 */
	arrowRole?: "shaft" | "head" | "shaft1" | "shaft2";
	/** Index of the arrow point a drag dot controls. */
	pointIndex?: number;
	isSticky?: boolean;
	/** Groups the background and textbox of one sticky note. */
	stickyPart?: string;
}

export function meta(obj: unknown): DiagramMeta {
	return (obj ?? {}) as DiagramMeta;
}
