package com.virtugene.app.plugins;

/** One bounded initial silence range. Public playback positions always count supplied voice only. */
final class AudioStartupPadding {
    private long voiceEnd = -1;
    private int requested, written;

    int claim(long suppliedFrames, int effectiveThreshold, int sampleRate) {
        if (voiceEnd >= 0 || suppliedFrames <= 0 || effectiveThreshold <= suppliedFrames || sampleRate <= 0
            || effectiveThreshold > (long) sampleRate * 3) return 0;
        voiceEnd = suppliedFrames;
        requested = (int) (effectiveThreshold - suppliedFrames);
        return requested;
    }
    void written(int frames) {
        if (frames < 0 || (long) written + frames > requested) throw new IllegalArgumentException("padding-frames");
        written += frames;
    }
    long voicePosition(long nativePosition) {
        if (voiceEnd < 0 || nativePosition <= voiceEnd) return nativePosition;
        return nativePosition - Math.min((long) written, nativePosition - voiceEnd);
    }
    int frames() { return written; }
    void reset() { voiceEnd = -1; requested = written = 0; }
}
