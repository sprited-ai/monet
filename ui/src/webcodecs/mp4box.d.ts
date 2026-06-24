// Vendored ESM bundle of mp4box (jsDelivr build of mp4box@0.5.2) — no upstream types.
// We use a tiny slice of the API (createFile, DataStream, the track/sample shapes),
// so `any` is fine; the typed surface lives in ClipDecoder.
declare module '*mp4box.mjs' {
  const MP4Box: {
    createFile(): any
    DataStream: any
    [k: string]: any
  }
  export default MP4Box
}
