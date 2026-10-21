'use strict';

/**
 * sound.js
 * --------
 * Sound effects for Memory Card Match, synthesised with the Web Audio API.
 *
 * Why synthesis instead of audio files:
 *   - no assets to download or ship
 *   - works completely offline, just like the rest of the game
 *   - the whole module is a few hundred bytes
 *
 * The AudioContext is created lazily on the first sound (browsers block audio
 * before a user gesture anyway) and every call is wrapped in try/catch, so a
 * browser without Web Audio simply plays silently instead of breaking.
 *
 * Public API (exposed as `window.Sound`):
 *   Sound.enabled          -> boolean
 *   Sound.setEnabled(v)    -> void
 *   Sound.toggle()         -> boolean (the new state)
 *   Sound.flip()           -> card flipped
 *   Sound.match()          -> pair found
 *   Sound.mismatch()       -> pair did not match
 *   Sound.start()          -> new game started
 *   Sound.win()            -> game won
 *   Sound.error()          -> something went wrong (e.g. saving failed)
 */

/**
 * Sound manager. Uses an IIFE so the internals stay private.
 */
const Sound = (() => {
  /** localStorage key holding the user's sound preference. */
  const STORAGE_KEY = 'mcm.sound';

  /** @type {AudioContext|null} */
  let context = null;
  /** @type {GainNode|null} master volume node */
  let master = null;

  /** Sound is on unless the user explicitly muted it. */
  let enabled = readPreference() !== 'off';

  /**
   * Reads the stored preference.
   * @returns {string|null}
   */
  function readPreference() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  /**
   * Stores the preference.
   * @param {string} value 'on' | 'off'
   */
  function writePreference(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {
      /* storage is optional */
    }
  }

  /**
   * Returns the AudioContext, creating it on first use.
   * @returns {AudioContext|null}
   */
  function getContext() {
    if (enabled === false) {
      return null;
    }
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return null;
      }
      try {
        context = new AudioContextClass();
        master = context.createGain();
        master.gain.value = 0.5;
        master.connect(context.destination);
      } catch (err) {
        context = null;
        master = null;
        return null;
      }
    }
    // Browsers suspend the context when the tab loses focus.
    if (context.state === 'suspended') {
      context.resume().catch(() => {
        /* the user has to interact again - fine */
      });
    }
    return context;
  }

  /**
   * Plays a single envelope-shaped oscillator.
   *
   * @param {object} options
   * @param {number} options.frequency      start frequency in Hz
   * @param {number} [options.endFrequency]  optional glide target
   * @param {number} [options.duration=0.15] length in seconds
   * @param {string} [options.type='sine']   oscillator waveform
   * @param {number} [options.volume=0.15]   peak volume
   * @param {number} [options.delay=0]       delay before the note starts
   */
  function tone({ frequency, endFrequency, duration = 0.15, type = 'sine', volume = 0.15, delay = 0 }) {
    const ctx = getContext();
    if (!ctx || !master) {
      return;
    }

    try {
      const start = ctx.currentTime + delay;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      }

      // Short attack / exponential decay envelope - avoids the "click" that a
      // raw start/stop would produce.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    } catch (err) {
      /* audio is a nice-to-have, never a hard requirement */
    }
  }

  return {
    /** @returns {boolean} whether sound effects are enabled */
    get enabled() {
      return enabled;
    },

    /**
     * Enables or disables sound effects and remembers the choice.
     * @param {boolean} value
     */
    setEnabled(value) {
      enabled = Boolean(value);
      writePreference(enabled ? 'on' : 'off');
      if (!enabled && context) {
        // Stop anything that is still ringing.
        try {
          master.gain.value = 0;
        } catch (err) {
          /* ignore */
        }
      } else if (enabled && master) {
        master.gain.value = 0.5;
      }
    },

    /**
     * Flips the sound state.
     * @returns {boolean} the new state
     */
    toggle() {
      this.setEnabled(!enabled);
      if (enabled) {
        tone({ frequency: 660, endFrequency: 880, duration: 0.12, type: 'triangle', volume: 0.12 });
      }
      return enabled;
    },

    /** Short blip when a card turns over. */
    flip() {
      tone({ frequency: 520, endFrequency: 700, duration: 0.09, type: 'sine', volume: 0.11 });
    },

    /** Bright arpeggio when two cards match. */
    match() {
      tone({ frequency: 660, duration: 0.11, type: 'triangle', volume: 0.13 });
      tone({ frequency: 880, duration: 0.12, type: 'triangle', volume: 0.13, delay: 0.09 });
      tone({ frequency: 1320, duration: 0.16, type: 'sine', volume: 0.11, delay: 0.18 });
    },

    /** Descending buzz when two cards do not match. */
    mismatch() {
      tone({ frequency: 320, endFrequency: 170, duration: 0.22, type: 'sawtooth', volume: 0.07 });
    },

    /** Soft two note sting when a new game begins. */
    start() {
      tone({ frequency: 440, duration: 0.1, type: 'sine', volume: 0.1 });
      tone({ frequency: 660, duration: 0.14, type: 'sine', volume: 0.1, delay: 0.11 });
    },

    /** Ascending fanfare when the player wins. */
    win() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      notes.forEach((frequency, index) => {
        tone({
          frequency,
          duration: index === notes.length - 1 ? 0.5 : 0.16,
          type: 'triangle',
          volume: 0.14,
          delay: index * 0.11,
        });
      });
    },

    /** Low buzz for failures (e.g. the score could not be saved). */
    error() {
      tone({ frequency: 200, endFrequency: 120, duration: 0.28, type: 'square', volume: 0.06 });
    },
  };
})();

// Expose the module for the other scripts (classic scripts share the global scope).
window.Sound = Sound;
