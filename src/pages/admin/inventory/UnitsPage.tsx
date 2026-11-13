/**
 * Units are managed on the catalogue screen, beside the shelves whose products they measure.
 *
 * This module is kept so the address, the lazy import and every link written before the merge
 * still resolve. The list itself lives in one place, so a unit and the shelves that use it are
 * read together instead of on two screens that never mention each other.
 */
export { default } from "./InventoryCataloguePage";
