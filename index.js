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
		this.released = this._released = null;

		this.onTouchStart = this.onTouchStart.bind(this);
		this.onTouchMove = this.onTouchMove.bind(this);
		this.onTouchEnd = this.onTouchEnd.bind(this);

		window.addEventListener('touchstart', this.onTouchStart);
		window.addEventListener('touchend', this.onTouchEnd);
	}

	emit({ name, args = [] } = {}) {
		this.cb && this.cb({ name, args });
	}

	cage(append = true, css = '') {
		document.querySelector('#--touch-gestures-cage')?.remove();
		document.querySelector('#--touch-gestures-cage-style')?.remove();

		if (append) {
			window.addEventListener('touchmove', this.onTouchMove, { passive: false });
		} else {
			window.removeEventListener('touchmove', this.onTouchMove);
		}

		if (!append) return this.emit({ name: 'uncage' });

		const el = document.createElement('div');
		const style = document.createElement('style');
		document.head.prepend(style);
		document.body.prepend(el);
		el.id = '--touch-gestures-cage';
		style.id = '--touch-gestures-cage-style';
		style.innerHTML = `
			#${el.id} {
				--left: 40px;
				--bottom: 60px;
				--width: 100px;
				--height: 100px;
				z-index: 9999;
				position: fixed;
				bottom: var(--bottom);
				left: var(--left);
				width: var(--width);
				height: var(--height);
				background: violet;
				opacity: 0.3;
				${css}
			}
		`;

		this.emit({ name: 'cage' });
	}

	getCage() {
		return document.querySelector('#--touch-gestures-cage');
	}

	onTouchStart(e) {
		this.caging = this.caging || e.target.id === '--touch-gestures-cage';

		const touchStart = this.getTouchInfo(e.changedTouches[0], e);
		this.ongoing.set(touchStart.identifier, { start: touchStart, update: touchStart });
		this.released = this.released || new Promise(r => this._released = r);
	}

	onTouchMove(e) {
		e.preventDefault();
		e.stopPropagation();
		Array.from(e.changedTouches).forEach(touch => {
			const touchInfo = this.getTouchInfo(touch, e);
			this.ongoing.get(touchInfo.identifier).update = touchInfo;
		});
	}

	onTouchEnd(e) {
		if (!this.squashing) {
			this.squashing = new Promise(requestAnimationFrame);
			this.squashing.then(() => {
				if (!this.ongoing) return;

				const ongoing = Array.from(this.ongoing.values()).map(i => {
					return this.getInteractionInfo(i.start, { ...i.update, time: performance.now() });
				});
				if (this.caging && !ongoing.length) {
					this.caging = false;
				}
				this.onInteraction(this.squashed, ongoing);
				this.squashing = null;
				this.squashed = [];
				if (!ongoing.length) {
					this.released.then(() => this.released = this._released = null);
					this._released();
				}
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
		const serial = this.serializeInteraction(touches, ongoing);
		this.emit({ name: 'interaction', args: { touches, ongoing, serial }  });
	}

	// TODO: comment
	serializeInteraction(touches, ongoing) {
		if (!touches.length) return '';
		const serial = [this.serializeGestures(touches)];
		ongoing.length && serial.push(serializeGestures(ongoing));
		return serial.join('|');
	}

	serializeGestures(gestures) {
		if (!gestures.length) return '';

		const cache = {
			tap: 0,
			hold: 0,
			swipes: {}
		};

		for (const gesture of gestures) {
			if (gesture.type === 'tap' || gesture.type === 'hold') {
				cache[gesture.type]++;
			} else if (gesture.type === 'swipe') {
				cache.swipes[gesture.direction] ||= { gesture, count: 0 };
				cache.swipes[gesture.direction].count++;
			}
		}

		const serialized = [];
		cache.tap && serialized.push(`${cache.tap}:tap`);
		cache.hold && serialized.push(`${cache.hold}:hold`);

		const swipes = Object.values(cache.swipes)
			.sort((a, b) => a.gesture.direction - b.gesture.direction)
			.map(({ gesture, count }) => `${count}:swipe:${this.angleToDir(gesture.direction)}`);
		swipes.length && serialized.push(swipes.join(','));

		return serialized.join(',');
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

	angleToDir(dir) {
		return {
			0: 'right',
			45: 'up-right',
			90: 'up',
			135: 'up-left',
			180: 'left',
			225: 'down-left',
			270: 'down',
			315: 'down-right'
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
		this.released = this._released = null;
	}
}
