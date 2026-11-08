/**
 * The Java releases a project may be set to compile against.
 *
 * Written down once because it used to be written down eight times — six
 * dropdowns in the interface and two checks in the main process — and a list
 * that has to be edited in eight places is a list that goes out of date. It
 * did: a project set to a release the check had not heard of was silently put
 * back to 21, with the dropdown still showing what had been asked for.
 *
 * Only the long-term releases and the ones still in support are offered, which
 * is what a project realistically targets. The main process keeps its own copy
 * in project-service.cjs; the two are pinned against each other by a test.
 */
export const JAVA_LANGUAGE_LEVELS = ["8", "11", "17", "21", "22", "23", "24", "25", "26"];
