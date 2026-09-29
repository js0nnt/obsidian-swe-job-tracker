/** Canvas navigation in SVG coordinates; centering always restores the full drawing. */
export function attachSankeyViewport(
	container: HTMLElement, svg: SVGSVGElement, width: number, height: number, signal: AbortSignal
): void {
	const toolbar = container.createEl("div", { cls: "job-tracker-sankey-navigation", attr: { "aria-label": "Sankey navigation", role: "toolbar" } });
	let zoom = 1;
	let x = 0;
	let y = 0;
	let drag: { id: number; clientX: number; clientY: number; x: number; y: number; scaleX: number; scaleY: number } | null = null;
	const button = (text: string, label: string, action: () => void) => {
		const el = toolbar.createEl("button", { text, attr: { type: "button", "aria-label": label, title: label } });
		el.addEventListener("click", action, { signal });
		return el;
	};
	const redraw = () => {
		svg.setAttribute("viewBox", `${x} ${y} ${width / zoom} ${height / zoom}`);
		readout.textContent = `${Math.round(zoom * 100)}%`;
	};
	const changeZoom = (factor: number, anchorX = x + width / zoom / 2, anchorY = y + height / zoom / 2) => {
		const next = Math.max(0.25, Math.min(5, zoom * factor));
		x = anchorX - (anchorX - x) * zoom / next;
		y = anchorY - (anchorY - y) * zoom / next;
		zoom = next;
		redraw();
	};
	const center = () => { x = 0; y = 0; zoom = 1; redraw(); };
	button("−", "Zoom out", () => changeZoom(1 / 1.25));
	const readout = toolbar.createEl("span", { cls: "job-tracker-sankey-zoom", attr: { "aria-live": "polite" } });
	button("+", "Zoom in", () => changeZoom(1.25));
	button("Center in view", "Center in view", center);
	svg.setAttribute("tabindex", "0");
	svg.addEventListener("wheel", e => {
		e.preventDefault();
		const matrix = svg.getScreenCTM();
		if (!matrix || drag) return;
		const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
		const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
		changeZoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.003), point.x, point.y);
	}, { signal, passive: false });
	svg.addEventListener("pointerdown", e => {
		if (e.button !== 0 || drag) return;
		const matrix = svg.getScreenCTM();
		if (!matrix) return;
		drag = { id: e.pointerId, clientX: e.clientX, clientY: e.clientY, x, y, scaleX: matrix.a, scaleY: matrix.d };
		svg.setPointerCapture(e.pointerId);
		svg.classList.add("is-panning");
	}, { signal });
	svg.addEventListener("pointermove", e => {
		if (!drag || drag.id !== e.pointerId) return;
		x = drag.x - (e.clientX - drag.clientX) / drag.scaleX;
		y = drag.y - (e.clientY - drag.clientY) / drag.scaleY;
		redraw();
	}, { signal });
	const endDrag = (e: PointerEvent) => {
		if (drag?.id !== e.pointerId) return;
		drag = null;
		svg.classList.remove("is-panning");
		if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
	};
	for (const event of ["pointerup", "pointercancel", "lostpointercapture"] as const) svg.addEventListener(event, endDrag, { signal });
	svg.addEventListener("keydown", e => {
		if (e.target !== svg) return;
		if (e.key === "+" || e.key === "=") changeZoom(1.25);
		else if (e.key === "-") changeZoom(1 / 1.25);
		else if (e.key === "Home" || e.key === "0") center();
		else if (e.key.startsWith("Arrow")) {
			const step = width / zoom * 0.05;
			if (e.key === "ArrowLeft") x -= step;
			if (e.key === "ArrowRight") x += step;
			if (e.key === "ArrowUp") y -= step;
			if (e.key === "ArrowDown") y += step;
			redraw();
		} else return;
		e.preventDefault();
	}, { signal });
	redraw();
}
