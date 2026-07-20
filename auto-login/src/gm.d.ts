// Overload pair, not one optional parameter: Tampermonkey returns the supplied
// default when a key is unset, so the two-arg form never yields undefined.
declare function GM_getValue(key: string): string | undefined;
declare function GM_getValue(key: string, defaultValue: string): string;

declare function GM_setValue(key: string, value: string): void;

/** Returns a listener id for GM_removeValueChangeListener. */
declare function GM_addValueChangeListener(
  key: string,
  fn: (key: string, oldValue: string | undefined, newValue: string | undefined, remote: boolean) => void,
): number;

/** Returns a menu command id for GM_unregisterMenuCommand. */
declare function GM_registerMenuCommand(caption: string, fn: () => void, accessKey?: string): number;
