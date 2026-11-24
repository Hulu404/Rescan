/**
 * Maps an on-screen rectangle to the pixels of a video shown with `object-fit: cover`.
 * @param {{width:number, height:number}} video  intrinsic size of the video frame
 * @param {{left:number, top:number, width:number, height:number}} box  the <video> element on screen
 * @param {{left:number, top:number, width:number, height:number}} guide  the framing guide on screen
 * @returns {null | {x:number, y:number, width:number, height:number}} region in video pixels, inside the frame
 */
export function coverRegion(video, box, guide) {
  if (!video.width || !video.height || !box.width || !box.height) return null;
  const scale = Math.max(box.width / video.width, box.height / video.height);
  // `cover` centres the video and hides whatever does not fit the element.
  const originX = box.left + (box.width - video.width * scale) / 2;
  const originY = box.top + (box.height - video.height * scale) / 2;
  const x0 = clamp(Math.round((guide.left - originX) / scale), video.width);
  const y0 = clamp(Math.round((guide.top - originY) / scale), video.height);
  const x1 = clamp(Math.round((guide.left + guide.width - originX) / scale), video.width);
  const y1 = clamp(Math.round((guide.top + guide.height - originY) / scale), video.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

function clamp(value, max) {
  return Math.min(max, Math.max(0, value));
}
