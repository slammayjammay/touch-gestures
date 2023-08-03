const DEFAULTS = {
	maxTapDuration: 170,
	maxTapMovement: 2,
	minSwipeMovement: 50,
	swipeAngleMargin: 45 / 2,
};

export default class TouchGestures {
	constructor(cb, options = {}) {
		this.cb = cb;
		this.options = { ...DEFAULTS, ...options };
		this.caging = false;
		this.ongoing = new Map();
		this.squashing = null;
		this.squashed = [];

		this.onTouchStart = this.onTouchStart.bind(this);
		this.onTouchMove = this.onTouchMove.bind(this);
		this.onTouchEnd = this.onTouchEnd.bind(this);

		window.addEventListener('touchstart', this.onTouchStart);
		window.addEventListener('touchend', this.onTouchEnd);
	}

	cage(append = true, css = '') {
		document.querySelector('#--touch-gestures-cage')?.remove();
		document.querySelector('#--touch-gestures-cage-style')?.remove();

		if (!append) {
			return;
		}

		const el = document.createElement('div');
		const style = document.createElement('style');
		document.head.prepend(style);
		document.body.prepend(el);
		el.id = '--touch-gestures-cage';
		style.id = '--touch-gestures-cage-style';
		style.innerHTML = `
			#${el.id} {
				z-index: 999999999999999999999999999999999999;
				position: fixed;
				--bottom: 80px;
				--size: 80px;
				bottom: var(--bottom);
				left: 0;
				width: var(--size);
				height: var(--size);
				background: violet;
				opacity: 0.3;
				${css}
			}
		`;

		window.addEventListener('touchmove', this.onTouchMove, { passive: false });
		this.cb && this.cb({ name: append ? 'cage' : 'uncage', args: [] });
	}

	getCage() {
		return document.querySelector('#--touch-gestures-cage');
	}

	onTouchStart(e) {
		this.caging = this.caging || e.target.id === '--touch-gestures-cage';

		if (this.caging) {
			e.preventDefault();
			e.stopPropagation();
		}
		const touchStart = this.getTouchInfo(e.changedTouches[0], e);
		this.ongoing.set(touchStart.identifier, { start: touchStart, update: touchStart });
	}

	onTouchMove(e) {
		if (this.caging) {
			e.preventDefault();
			e.stopPropagation();
			Array.from(e.changedTouches).forEach(touch => {
				const touchInfo = this.getTouchInfo(touch, e);
				this.ongoing.get(touchInfo.identifier).update = touchInfo;
			});
		}
	}

	onTouchEnd(e) {
		if (this.caging) {
			e.preventDefault();
			e.stopPropagation();
		}
		if (!this.squashing) {
			this.squashing = new Promise(r => setTimeout(r, 16));
			this.squashing.then(() => {
				const ongoing = Array.from(this.ongoing.values()).map(i => {
					return this.getInteractionInfo(i.start, { ...i.update, time: performance.now() });
				});
				if (this.caging && !ongoing.length) {
					this.caging = false;
				}
				this.onInteraction(this.squashed, ongoing);
				this.squashing = null;
				this.squashed = [];
			});
		}

		const touchEnd = this.getTouchInfo(e.changedTouches[0], e);
		const touchStart = this.ongoing.get(touchEnd.identifier).start;
		this.ongoing.delete(touchEnd.identifier);

		const interactionInfo = this.getInteractionInfo(touchStart, touchEnd);
		this.squashed.push(interactionInfo);
	}

	getTouchInfo(touch, e) {
		const { identifier, screenX, screenY } = touch;
		return { e, identifier, screenX, screenY, time: performance.now() };
	}

	getInteractionInfo(touchStart, touchEnd) {
		const dt = touchEnd.time - touchStart.time;
		const dx = touchEnd.screenX - touchStart.screenX;
		const dy = touchStart.screenY - touchEnd.screenY;
		const degrees = this.getDegrees(dx, dy);
		const direction = dx === 0 && dy === 0 ? 0 : this.getSwipeDirection(degrees);
		let type = null;

		const absdx = Math.abs(dx);
		const absdy = Math.abs(dy);

		if (dt <= this.options.maxTapDuration && absdx < this.options.maxTapMovement && absdy < this.options.maxTapMovement) {
			type = 'tap';
		} else if (Math.abs(dx) >= this.options.minSwipeMovement || Math.abs(dy) >= this.options.minSwipeMovement) {
			type = 'swipe';
		} else {
			type = 'hold';
		}

		return { dt, dx, dy, degrees, direction, type, startEvent: touchStart.e, endEvent: touchEnd.e };
	}

	getDegrees(dx, dy) {
		dx = dx || 0.001;

		const degrees = Math.atan(dy / dx) * 180 / Math.PI;
		if (dx > 0 && dy >= 0) return degrees;
		if (dx < 0) return degrees + 90 * 2;
		if (dx > 0 && dy < 0) return 360 + degrees;
	}

	getSwipeDirection(degrees) {
		for (let i = 0, l = 9; i < l; i++) {
			if (Math.abs(45 * i - degrees) <= this.options.swipeAngleMargin) {
				return (45 * i) % 360;
			}
		}

		return null;
	}

	onInteraction(touches, ongoing) {
		if (this.cb && this.cb({ name: 'interaction', args: [touches, ongoing] }) === false) {
			return;
		}

		if (this.two(touches, { type: 'tap' }) && this.one(ongoing, { type: 'hold' })) {
			this.cage(!this.getCage());
		}
	}

	dirToAngle(dir) {
		return {
			'right': 0,
			'up-right': 45,
			'up': 90,
			'up-left': 135,
			'left': 180,
			'down-left': 225,
			'down': 270,
			'down-right': 315
		}[dir];
	}

	compare(gesture, specs = {}) {
		return Object.entries(specs).every(([key, val]) => {
			key = { dir: 'direction' }[key] || key;
			const check = (g, v) => g[key] === (key === 'direction' && typeof v === 'string' ? this.dirToAngle(v) : v);
			return Array.isArray(val) ? val.some(value => check(gesture, value)) : check(gesture, val);
		});
	}

	all(gestures, specs, length = gestures.length) {
		return gestures.length !== length ? false : gestures.every(g => this.compare(g, specs));
	}

	zero(gestures) {
		return gestures.length === 0;
	}

	one(gestures, specs) {
		return gestures.length !== 1 ? false : this.compare(gestures[0], specs);
	}

	two(gestures, specs) { return this.all(gestures, specs, 2); }
	three(gestures, specs) { return this.all(gestures, specs, 3); }
	four(gestures, specs) { return this.all(gestures, specs, 4); }
	five(gestures, specs) { return this.all(gestures, specs, 5); }

	destroy() {
		this.cage(false);
		window.removeEventListener('touchstart', this.onTouchStart);
		window.removeEventListener('touchend', this.onTouchEnd);

		this.cb = null;
		this.caging = false;
		this.ongoing = this.squashing = this.squashed = null;
	}
}
