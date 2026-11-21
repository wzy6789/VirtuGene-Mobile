package com.virtugene.app.plugins;

public final class AudioRouteLoss {
    private AudioRouteLoss() {}
    public static boolean affectsCall(int[] removed, int input, int output, int communication) {
        for (int id : removed) if (id > 0 && (id == input || id == output || id == communication)) return true;
        return false;
    }
    /** An explicit in-flight selection may change routes; passive refresh cannot authorize one. */
    public static boolean unexpectedCommunicationChange(int confirmed, int current, boolean selecting) {
        return !selecting && confirmed > 0 && confirmed != current;
    }
    public static boolean privateRouteFellBack(boolean privatePathExpected, boolean localPathObserved) {
        return privatePathExpected && localPathObserved;
    }
}
