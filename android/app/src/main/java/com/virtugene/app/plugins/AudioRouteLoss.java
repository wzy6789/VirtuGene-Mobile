package com.virtugene.app.plugins;

public final class AudioRouteLoss {
    private AudioRouteLoss() {}
    public static boolean affectsCall(int[] removed, int input, int output, int communication) {
        for (int id : removed) if (id > 0 && (id == input || id == output || id == communication)) return true;
        return false;
    }
}
