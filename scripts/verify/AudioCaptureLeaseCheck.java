package com.virtugene.app.plugins;

public final class AudioCaptureLeaseCheck {
    public static void main(String[] args) {
        Object voiceMessage = new Object(), voiceCall = new Object();
        check(AudioCaptureLease.acquire(voiceMessage));
        check(!AudioCaptureLease.acquire(voiceCall));
        AudioCaptureLease.release(voiceCall);
        check(!AudioCaptureLease.acquire(voiceCall));
        AudioCaptureLease.release(voiceMessage);
        check(AudioCaptureLease.acquire(voiceCall));
        check(AudioCaptureLease.acquire(voiceCall));
        AudioCaptureLease.release(voiceCall);
        check(AudioCaptureLease.acquire(voiceMessage));
        AudioCaptureLease.release(voiceMessage);
        System.out.println("6 microphone ownership checks passed; device audio not tested");
    }
    private static void check(boolean result) { if (!result) throw new AssertionError("microphone ownership violation"); }
}
