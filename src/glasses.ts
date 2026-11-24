// The ONLY file that talks to the Even Hub SDK. Everything else is plain, tested logic.
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from "@evenrealities/even_hub_sdk";
import type { Input } from "./state.ts";

const ID = 1;
const NAME = "main";

// Enum members are read defensively so a renamed member can't crash the build.
const E = OsEventTypeList as unknown as Record<string, number>;
const CLICK = E.CLICK_EVENT ?? 0;
const SCROLL_TOP = E.SCROLL_TOP_EVENT ?? 1;
const SCROLL_BOTTOM = E.SCROLL_BOTTOM_EVENT ?? 2;
const DOUBLE_CLICK = E.DOUBLE_CLICK_EVENT ?? 3;

export type Glasses = {
  show(text: string): Promise<void>;
  onInput(cb: (i: Input) => void): void;
  /** Start the microphone; `cb` receives raw 16 kHz 16-bit mono PCM chunks. */
  micStart(cb: (chunk: Uint8Array) => void): Promise<void>;
  micStop(): Promise<void>;
};

function toBytes(x: unknown): Uint8Array | null {
  if (x instanceof Uint8Array) return x;
  if (Array.isArray(x)) return Uint8Array.from(x as number[]);
  if (typeof x === "string") {
    try { return Uint8Array.from(atob(x), (c) => c.charCodeAt(0)); } catch { return null; }
  }
  return null;
}

export async function connectGlasses(firstText: string): Promise<Glasses> {
  const bridge = await waitForEvenAppBridge();

  const main = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 6,
    containerID: ID,
    containerName: NAME,
    content: firstText,
    isEventCapture: 1, // required, or the container receives no input
  });

  const result = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [main] }),
  );
  if (result !== 0) {
    throw new Error(`createStartUpPageContainer failed with code ${result} (1=invalid, 2=oversize, 3=out of memory)`);
  }

  let micCb: ((c: Uint8Array) => void) | null = null;
  let inputCb: ((i: Input) => void) | null = null;

  // One handler for everything the glasses send us.
  bridge.onEvenHubEvent((event) => {
    const ev = event as any;
    if (ev.audioEvent?.audioPcm !== undefined) {
      const bytes = toBytes(ev.audioEvent.audioPcm);
      if (bytes && micCb) micCb(bytes);
      return;
    }
    const src = ev.textEvent ?? ev.sysEvent;
    if (!src || !inputCb) return;
    // The SDK reports a plain click as `undefined` in some cases.
    const t: number | undefined = src.eventType;
    if (t === undefined || t === CLICK) return inputCb("TAP");
    if (t === DOUBLE_CLICK) return inputCb("DOUBLE_TAP");
    if (t === SCROLL_BOTTOM) return inputCb("NEXT");
    if (t === SCROLL_TOP) return inputCb("PREV");
  });

  return {
    async show(text: string) {
      await bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: ID, containerName: NAME, content: text }),
      );
    },
    onInput(cb) { inputCb = cb; },
    async micStart(cb) {
      micCb = cb;
      const ok = await (bridge as any).audioControl(true);
      if (ok === false) { micCb = null; throw new Error("microphone could not start"); }
    },
    async micStop() {
      try { await (bridge as any).audioControl(false); } finally { micCb = null; }
    },
  };
}
