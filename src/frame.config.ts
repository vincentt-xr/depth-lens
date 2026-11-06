// frame.config.ts — how the app fills the screen. The creator's setting.
//
//   "phone"  a fixed 9:16 portrait frame: pillarboxed on wide screens, full width
//            on a phone, so every experience is framed the same everywhere.
//            Default.
//   "full"   the whole viewport, edge to edge: the canvas is the page. On a phone
//            that is the phone's own portrait ratio, under the notch and the home
//            bar; on a desktop it is the whole window, which suits the webcam.
//            The SDK cover-crops the camera to the canvas, so tracking, anchors
//            and masks stay aligned on every ratio.
//
// Change the value below; `src/FrameContainer.tsx` reads it. (No app.config.json
// key: `vincentt build` refuses keys it does not know.)
export type FrameMode = "phone" | "full";

export const frame: FrameMode = "phone";
