// Offscreen document: owns the Player (a service worker cannot play audio)
// and bridges it to runtime messages.
import { MSG, TARGET } from "../lib/contract.js";
import { synthesize } from "../lib/kokoro-client.js";
import { Player } from "../lib/player.js";

const player = new Player({
  synthesize: (args) => synthesize(args),
  createAudio: (url) => new Audio(url),
  onState: (state) => {
    // Nobody may be listening (popup closed): "no receiver" is expected.
    chrome.runtime.sendMessage({ target: TARGET.UI, type: MSG.PLAYER_STATE, state }).catch(() => {});
  },
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== TARGET.OFFSCREEN) return false;

  switch (message.type) {
    case MSG.PLAYER_PLAY:
      player.play(message.text, {
        voice: message.voice,
        speed: message.speed,
        serverUrl: message.serverUrl,
        startIndex: message.startIndex,
      });
      break;
    case MSG.PLAYER_PAUSE:
      player.pause();
      break;
    case MSG.PLAYER_RESUME:
      player.resume();
      break;
    case MSG.PLAYER_STOP:
      player.stop();
      break;
    case MSG.PLAYER_SET_SPEED:
      player.setSpeed(message.speed);
      break;
    case MSG.PLAYER_GET_STATE:
      sendResponse(player.getState());
      return false;
    default:
      return false;
  }
  sendResponse({ ok: true });
  return false;
});
