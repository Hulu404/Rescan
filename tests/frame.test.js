import test from 'node:test';
import assert from 'node:assert/strict';
import { coverRegion } from '../shared/frame.js';

const screen = { left: 0, top: 0, width: 390, height: 844 };

test('portrait video wider than the screen: hidden side strips are accounted for', () => {
  // cover scale = 844/1920; visible columns are 96.4…983.6 of 1080, edges rounded
  const region = coverRegion({ width: 1080, height: 1920 }, screen, { left: 0, top: 0, width: 390, height: 844 });
  assert.deepEqual(region, { x: 96, y: 0, width: 888, height: 1920 });
});

test('landscape video on a portrait screen is cropped to the same place the employee sees', () => {
  // cover scale = 844/1080; the centre of the screen is the centre of the frame
  const region = coverRegion({ width: 1920, height: 1080 }, screen, { left: 95, top: 322, width: 200, height: 200 });
  assert.ok(Math.abs(region.x + region.width / 2 - 960) <= 1);
  assert.ok(Math.abs(region.y + region.height / 2 - 540) <= 1);
  assert.equal(region.width, 256);
});

test('element offset on the page does not shift the crop', () => {
  const shifted = coverRegion({ width: 1080, height: 1920 }, { ...screen, left: 50, top: 70 }, { left: 73, top: 418, width: 343, height: 122 });
  const plain = coverRegion({ width: 1080, height: 1920 }, screen, { left: 23, top: 348, width: 343, height: 122 });
  assert.deepEqual(shifted, plain);
});

test('region never leaves the video and is null when there is nothing to crop', () => {
  const region = coverRegion({ width: 1080, height: 1920 }, screen, { left: -500, top: -500, width: 3000, height: 3000 });
  assert.deepEqual(region, { x: 0, y: 0, width: 1080, height: 1920 });
  assert.equal(coverRegion({ width: 0, height: 0 }, screen, screen), null);
  assert.equal(coverRegion({ width: 1080, height: 1920 }, { ...screen, width: 0 }, screen), null);
  assert.equal(coverRegion({ width: 1080, height: 1920 }, screen, { left: 900, top: 0, width: 50, height: 50 }), null);
});
