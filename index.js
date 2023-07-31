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
		this.overriding = false;
		this.caged = false;
		this.ongoing = new Map();
		this.squashing = null;
		this.squashed = [];

		this.onTouchStart = this.onTouchStart.bind(this);
		this.onTouchMove = this.onTouchMove.bind(this);
		this.onTouchEnd = this.onTouchEnd.bind(this);

		window.addEventListener('touchstart', this.onTouchStart);
		window.addEventListener('touchend', this.onTouchEnd);
	}

	overrideNativeTouch(setDisabled = true) {
		this.overriding = setDisabled;

		const meta = document.querySelector('meta[name=viewport]');
		if (!setDisabled && meta.hasAttribute('data-previous')) {
			const previous = meta.getAttribute('data-previous');
			meta.content = previous;
			meta.removeAttribute('data-previous');
		} else {
			meta.setAttribute('data-previous', meta.content);
			meta.content = 'width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no';
		}

		this.cage(setDisabled);
		window[setDisabled ? 'addEventListener' : 'removeEventListener']('touchmove', this.onTouchMove, { passive: false });

		this.cb && this.cb({ name: setDisabled ? 'native-override' : 'override-restore', args: [] });
	}

	cage(append) {
		this.caged = append;

		if (!append) {
			document.querySelector('#gesture-cage')?.remove();
			document.querySelector('#gesture-cage-style')?.remove();
			return;
		}

		const el = document.createElement('div');
		const style = document.createElement('style');
		document.head.prepend(style);
		document.body.prepend(el);
		el.id = 'gesture-cage';
		style.id = 'gesture-cage-style';
		style.innerHTML = `
				#gesture-cage {
					z-index: 999999999999999999999999999999999999;
					position: fixed;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					width: 100vw;
					height: 100vh;
					background: violet;
					opacity: 0.3;
				}
			`;

		this.cb && this.cb({ name: append ? 'cage' : 'uncage', args: [] });
	}

	onTouchStart(e) {
		if (this.caged) {
			e.preventDefault();
			e.stopPropagation();
		}
		const touchStart = this.getTouchInfo(e.changedTouches[0], e);
		this.ongoing.set(touchStart.identifier, { start: touchStart, update: touchStart });
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
		if (this.caged) {
			e.preventDefault();
			e.stopPropagation();
		}
		if (!this.squashing) {
			this.squashing = new Promise(r => setTimeout(r, 16));
			this.squashing.then(() => {
				const ongoing = Array.from(this.ongoing.values()).map(i => {
					return this.getInteractionInfo(i.start, { ...i.update, time: performance.now() });
				});
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

		console.log(dx, dy);
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

		if (
			touches.length === 1 &&
			touches[0].type === 'tap' &&
			ongoing.length === 3 &&
			ongoing.every(i => i.type === 'hold')
		) {
			this.overrideNativeTouch(!this.overriding);
		} else if (touches.length === 3 && touches.every(i => i.direction === 270)) {
			this.cage(false);
		} else if (!this.caged && touches.length === 3 && touches.every(i => i.direction === 90)) {
			this.cage(true);
		}
	}

	destroy() {
		this.overrideNativeTouch(false);
		window.removeEventListener('touchstart', this.onTouchStart);
		window.removeEventListener('touchend', this.onTouchEnd);

		this.cb = null;
		this.overriding = this.caged = false;
		this.ongoing = this.squashing = this.squashed = null;
	}
}
