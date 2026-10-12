package com.virtugene.app.plugins;

/** Streaming, bounded mono PCM conversion for Android 24-30 narrowband SCO. */
final class LegacyScoPcm {
    private static final int TAPS = 31;
    private static final double[] FILTER = coefficients();
    private final short[] history = new short[TAPS];
    private int cursor, phase;
    private short previousInput;

    private static double[] coefficients() {
        double[] coefficients = new double[TAPS]; double sum = 0;
        // Cut below 4kHz before decimating 24kHz to 8kHz.
        for (int i = 0; i < TAPS; i++) {
            int offset = i - (TAPS - 1) / 2;
            double sinc = offset == 0 ? .28 : Math.sin(2 * Math.PI * .14 * offset) / (Math.PI * offset);
            coefficients[i] = sinc * (.54 - .46 * Math.cos(2 * Math.PI * i / (TAPS - 1))); sum += coefficients[i];
        }
        for (int i = 0; i < TAPS; i++) coefficients[i] /= sum;
        return coefficients;
    }
    byte[] output24kTo8k(byte[] pcm) {
        if (pcm.length % 2 != 0) throw new IllegalArgumentException("unaligned PCM16");
        byte[] result = new byte[((pcm.length / 2 + phase) / 3) * 2]; int written = 0;
        for (int offset = 0; offset < pcm.length; offset += 2) {
            short sample = (short) ((pcm[offset] & 255) | pcm[offset + 1] << 8);
            history[cursor] = sample; cursor = (cursor + 1) % TAPS;
            if (++phase < 3) continue;
            phase = 0; double value = 0;
            for (int tap = 0; tap < TAPS; tap++) value += history[(cursor - 1 - tap + TAPS) % TAPS] * FILTER[tap];
            int filtered = (int) Math.max(-32768, Math.min(32767, Math.round(value)));
            result[written++] = (byte) filtered; result[written++] = (byte) (filtered >> 8);
        }
        return result;
    }
    short[] input8kTo16k(short[] samples, int count) {
        if (count < 0 || count > samples.length) throw new IllegalArgumentException("invalid input");
        short[] result = new short[count * 2];
        for (int i = 0; i < count; i++) {
            result[i * 2] = (short) (((int) previousInput + samples[i]) / 2);
            result[i * 2 + 1] = samples[i]; previousInput = samples[i];
        }
        return result;
    }
}
