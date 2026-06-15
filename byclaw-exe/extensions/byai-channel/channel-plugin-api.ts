// Keep bundled channel entry imports narrow so bootstrap/discovery paths do
// not drag the broad channel implementation into lightweight plugin loads.
export { byaiChannelPlugin } from "./src/channel.js";
