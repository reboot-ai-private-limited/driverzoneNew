// Bundled images. Metro resolves an image import to an asset id (a number) and picks the
// @2x/@3x file for the device's density at runtime; this tells TypeScript that much.
declare module '*.png' {
  const source: number;
  export default source;
}
