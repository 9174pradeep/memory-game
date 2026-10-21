'use strict';

/**
 * confetti.js
 * -----------
 * A small canvas based confetti celebration for the win screen.
 *
 * Design notes:
 *   - the canvas is created on demand and removed when the animation ends,
 *     so it never interferes with the rest of the UI
 *   - it is `pointer-events: none`, so it can never block a click
 *   - users who asked for reduced motion get a static, short burst instead of
 *     a full animation
 *
 * Public API (exposed as `window.Confetti`):
 *   Confetti.burst(options) -> void
 */

/**
 * Confetti manager. Uses an IIFE so the internals stay private.
 */
const Confetti = (() => {
  /** @type {HTMLCanvasElement|null} */
  let canvas = null;
  /** @type {CanvasRenderingContext2D|null} */
  let context = null;
  /** @type {Array<object>} */
  let particles = [];
  /** @type {number|null} */
  let animationId = null;

  /** Palette that matches the dark theme of the game. */
  const COLORS = ['#7c5cff', '#9a83ff', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#ffffff'];

  /** Gravity applied to every particle (px / frame²). */
  const GRAVITY = 0.16;

  /**
   * Whether the user asked for reduced motion.
   * @returns {boolean}
   */
  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /**
   * Creates the canvas layer (once) and sizes it to the viewport.
   * @returns {boolean} true when the canvas is ready
   */
  function ensureCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'confetti-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
    }
    context = canvas.getContext('2d');
    if (!context) {
      return false;
    }
    resize();
    return true;
  }

  /** Matches the canvas size to the current viewport. */
  function resize() {
    if (!canvas) {
      return;
    }
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  }

  /**
   * Spawns a burst of particles.
   * @param {object} [options]
   * @param {number} [options.count=140]   number of particles
   * @param {number} [options.spread=1]    horizontal spread multiplier
   * @param {number} [options.originY=0.35] vertical origin (0 = top)
   */
  function spawn({ count = 140, spread = 1, originY = 0.35 } = {}) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (5 + Math.random() * 9) * spread;
      particles.push({
        x: width * (0.5 + (Math.random() - 0.5) * 0.7),
        y: height * originY,
        vx: Math.cos(angle) * speed * 0.7 + (Math.random() - 0.5) * 3,
        vy: Math.sin(angle) * speed - Math.random() * 6 - 4,
        size: 5 + Math.random() * 7,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.35,
        wobble: Math.random() * Math.PI * 2,
        life: 1,
      });
    }
  }

  /**
   * Advances the animation by one frame.
   */
  function frame() {
    if (!context || !canvas) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);

    particles = particles.filter((particle) => {
      particle.vy += GRAVITY;
      particle.vx += Math.sin(particle.wobble) * 0.06;
      particle.wobble += 0.06;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.rotationSpeed;
      particle.life -= 0.0075;

      if (particle.life <= 0 || particle.y > canvas.height + 60) {
        return false;
      }

      context.save();
      context.globalAlpha = Math.max(0, particle.life);
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      // A small rectangle that flips - looks like a paper strip.
      context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
      context.restore();
      return true;
    });

    if (particles.length > 0) {
      animationId = window.requestAnimationFrame(frame);
    } else {
      stop();
    }
  }

  /** Stops the animation and removes the canvas from the page. */
  function stop() {
    if (animationId !== null) {
      window.cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (canvas) {
      canvas.remove();
      canvas = null;
      context = null;
    }
    particles = [];
  }

  return {
    /**
     * Fires a confetti burst.
     * @param {object} [options] see spawn()
     */
    burst(options = {}) {
      try {
        if (!ensureCanvas()) {
          return;
        }
        window.addEventListener('resize', resize, { passive: true });

        if (prefersReducedMotion()) {
          // Reduced motion: a single short, static spray instead of a long fall.
          spawn({ count: 24, spread: 0.5, originY: 0.3 });
        } else {
          spawn(options);
        }
        if (animationId === null) {
          animationId = window.requestAnimationFrame(frame);
        }
      } catch (err) {
        /* confetti is decorative - never break the game for it */
      }
    },

    /** Removes the confetti layer (used when a new game starts). */
    stop,
  };
})();

// Expose the module for the other scripts (classic scripts share the global scope).
window.Confetti = Confetti;
