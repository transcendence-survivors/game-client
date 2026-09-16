export function smoothstep(
	edge0: number,
	edge1: number,
	value: number,
): number {
	const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

export function hash2(x: number, z: number, seed: number): number {
	let value =
		(seed >>> 0) ^
		Math.imul(x | 0, 0x45d9f3b) ^
		Math.imul(z | 0, 0x119de1f3);
	value = Math.imul(value ^ (value >>> 16), 0x27d4eb2d);
	value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
	return ((value ^ (value >>> 13)) >>> 0) / 4294967296;
}

export function valueNoise2d(x: number, z: number, seed: number): number {
	const x0 = Math.floor(x);
	const z0 = Math.floor(z);
	const tx = smoothstep(0, 1, x - x0);
	const tz = smoothstep(0, 1, z - z0);
	const a = hash2(x0, z0, seed);
	const b = hash2(x0 + 1, z0, seed);
	const c = hash2(x0, z0 + 1, seed);
	const d = hash2(x0 + 1, z0 + 1, seed);
	const ab = a + (b - a) * tx;
	const cd = c + (d - c) * tx;
	return (ab + (cd - ab) * tz) * 2 - 1;
}

export function fbm2d(x: number, z: number, seed: number): number {
	let value = 0;
	let amplitude = 0.5;
	let frequency = 1;
	let normalization = 0;
	for (let octave = 0; octave < 4; octave++) {
		value +=
			valueNoise2d(
				x * frequency,
				z * frequency,
				seed + octave * 0x9e3779b9,
			) * amplitude;
		normalization += amplitude;
		amplitude *= 0.5;
		frequency *= 2;
	}
	return value / normalization;
}
