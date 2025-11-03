/**
 * HoverCard - Lightweight positioning utility
 *
 * Works with native Popover API and HTMX for state management.
 * This script only handles smart positioning logic.
 *
 * The Popover API handles: show/hide state, focus management, ESC key
 * HTMX handles: hover events, timers, user interactions
 * This script handles: positioning and viewport collision detection
 */

window.HoverCard = {
	/**
	 * Position a popover relative to its trigger with smart collision detection
	 * @param {HTMLElement} root - The .hovercard-root element
	 * @param {HTMLElement} popover - The popover content element
	 */
	position(root, popover) {
		const trigger = root.querySelector('.hovercard-trigger');
		if (!trigger) return;

		const preferredSide = root.dataset.side || 'top';
		const triggerRect = trigger.getBoundingClientRect();
		const popoverRect = popover.getBoundingClientRect();
		const gap = 8;

		// Try preferred side first, then fallbacks
		const sideOrder = this._getSideOrder(preferredSide);

		for (const side of sideOrder) {
			const position = this._calculatePosition(
				side,
				triggerRect,
				popoverRect,
				gap
			);

			if (this._fitsInViewport(position, popoverRect)) {
				this._applyPosition(popover, position, side);
				return;
			}
		}

		// Fallback: use preferred side even if it doesn't fit perfectly
		const fallbackPosition = this._calculatePosition(
			preferredSide,
			triggerRect,
			popoverRect,
			gap
		);
		this._applyPosition(popover, fallbackPosition, preferredSide);
	},

	_getSideOrder(preferredSide) {
		const orders = {
			top: ['top', 'bottom', 'right', 'left'],
			bottom: ['bottom', 'top', 'right', 'left'],
			left: ['left', 'right', 'top', 'bottom'],
			right: ['right', 'left', 'top', 'bottom'],
		};
		return orders[preferredSide] || orders.top;
	},

	_calculatePosition(side, triggerRect, popoverRect, gap) {
		let top, left;

		switch (side) {
			case 'top':
				top = triggerRect.top - popoverRect.height - gap;
				left = triggerRect.left + (triggerRect.width - popoverRect.width) / 2;
				break;

			case 'bottom':
				top = triggerRect.bottom + gap;
				left = triggerRect.left + (triggerRect.width - popoverRect.width) / 2;
				break;

			case 'left':
				top = triggerRect.top + (triggerRect.height - popoverRect.height) / 2;
				left = triggerRect.left - popoverRect.width - gap;
				break;

			case 'right':
				top = triggerRect.top + (triggerRect.height - popoverRect.height) / 2;
				left = triggerRect.right + gap;
				break;

			default:
				top = triggerRect.top - popoverRect.height - gap;
				left = triggerRect.left + (triggerRect.width - popoverRect.width) / 2;
		}

		return { top, left };
	},

	_fitsInViewport(position, popoverRect) {
		const padding = 8;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		return (
			position.top >= padding &&
			position.left >= padding &&
			position.top + popoverRect.height <= viewportHeight - padding &&
			position.left + popoverRect.width <= viewportWidth - padding
		);
	},

	_applyPosition(popover, position, side) {
		popover.style.top = `${position.top}px`;
		popover.style.left = `${position.left}px`;
		popover.setAttribute('data-positioned-side', side);
	},
};
