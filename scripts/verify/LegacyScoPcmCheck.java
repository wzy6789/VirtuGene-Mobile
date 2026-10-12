package com.virtugene.app.plugins;
import java.util.Arrays;
public final class LegacyScoPcmCheck {
    public static void main(String[] args) {
        byte[] input = new byte[4800];
        for (int i = 0; i < 2400; i++) { short value = (short) Math.round(12000 * Math.sin(2 * Math.PI * 300 * i / 24000)); input[i * 2] = (byte) value; input[i * 2 + 1] = (byte) (value >> 8); }
        LegacyScoPcm whole = new LegacyScoPcm(), fragmented = new LegacyScoPcm();
        byte[] expected = whole.output24kTo8k(input), result = new byte[expected.length]; int cursor = 0;
        for (int offset = 0; offset < input.length; offset += 14) {
            byte[] part = fragmented.output24kTo8k(Arrays.copyOfRange(input, offset, Math.min(input.length, offset + 14)));
            System.arraycopy(part, 0, result, cursor, part.length); cursor += part.length;
        }
        check(expected.length == 1600); check(Arrays.equals(expected, result));
        double lowEnergy = energy(expected), highEnergy = energy(new LegacyScoPcm().output24kTo8k(tone(9000)));
        check(lowEnergy > 5000 && highEnergy < lowEnergy * .05);
        LegacyScoPcm inputWhole = new LegacyScoPcm(), inputParts = new LegacyScoPcm();
        short[] samples = { -30000, -10000, 10000, 30000 };
        short[] expanded = inputWhole.input8kTo16k(samples, samples.length);
        short[] first = inputParts.input8kTo16k(Arrays.copyOfRange(samples, 0, 1), 1), rest = inputParts.input8kTo16k(Arrays.copyOfRange(samples, 1, 4), 3);
        short[] combined = new short[8]; System.arraycopy(first, 0, combined, 0, 2); System.arraycopy(rest, 0, combined, 2, 6);
        check(expanded.length == 8 && Arrays.equals(expanded, combined));
        check(expanded[expanded.length - 1] == 30000);
        boolean invalid = false; try { whole.output24kTo8k(new byte[1]); } catch (IllegalArgumentException error) { invalid = true; } check(invalid);
        check(whole.output24kTo8k(new byte[0]).length == 0);
        System.out.println("7 streaming SCO PCM checks passed; device routing not tested");
    }
    private static byte[] tone(int hz) {
        byte[] data = new byte[4800]; for (int i = 0; i < 2400; i++) { short value = (short) Math.round(12000 * Math.sin(2 * Math.PI * hz * i / 24000)); data[i * 2] = (byte) value; data[i * 2 + 1] = (byte) (value >> 8); } return data;
    }
    private static double energy(byte[] data) { double sum = 0; for (int i = 200; i < data.length; i += 2) { short sample = (short) ((data[i] & 255) | data[i + 1] << 8); sum += sample * (double) sample; } return Math.sqrt(sum / ((data.length - 200) / 2)); }
    private static void check(boolean value) { if (!value) throw new AssertionError("SCO PCM contract failed"); }
}
