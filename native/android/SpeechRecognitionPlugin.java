package com.agrishop.app;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * The microphone for the bundled Android app.
 *
 * Android System WebView does not implement the Web Speech API reliably, so `listen()` in the web
 * layer would report "unsupported" on an installed APK even when the phone has a recognizer. This
 * plugin exposes the phone's own SpeechRecognizer with the same result/end/error shape the web
 * fallback uses.
 */
@CapacitorPlugin(
    name = "SpeechRecognition",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class SpeechRecognitionPlugin extends Plugin {

    private SpeechRecognizer recognizer;

    @PluginMethod
    public void start(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("unsupported");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermission");
            return;
        }
        beginListening(call);
    }

    @PermissionCallback
    private void microphonePermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            beginListening(call);
        } else {
            call.reject("permission");
        }
    }

    private void beginListening(PluginCall call) {
        String requestedLang = call.getString("lang", "en-US");
        // Android recognizers commonly advertise en-US/en-GB but not en-PK. The old English
        // default made the recognizer fail immediately with ERROR_LANGUAGE_NOT_SUPPORTED, which
        // the screen could only report as "I could not hear that". Keep this guard for callers
        // built before the language default changed.
        String lang = "en-PK".equalsIgnoreCase(requestedLang) ? "en-US" : requestedLang;
        getActivity().runOnUiThread(() -> {
            try {
                destroyRecognizer();
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onReadyForSpeech(Bundle params) {}
                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {}
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() {}
                    @Override public void onEvent(int eventType, Bundle params) {}

                    @Override
                    public void onPartialResults(Bundle partialResults) {
                        sendText(partialResults, false);
                    }

                    @Override
                    public void onResults(Bundle results) {
                        sendText(results, true);
                        finishSession();
                    }

                    @Override
                    public void onError(int error) {
                        JSObject event = new JSObject();
                        event.put("code", codeForError(error));
                        // Kept for logcat/diagnosis; the UI translates the stable code above.
                        event.put("reason", error);
                        notifyListeners("error", event);
                        finishSession();
                    }
                });

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
                intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);

                recognizer.startListening(intent);
                call.resolve();
            } catch (Exception error) {
                destroyRecognizer();
                call.reject("failed");
            }
        });
    }

    private String codeForError(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "permission";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no_speech";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
            case 11: // ERROR_SERVER_DISCONNECTED (API 31); numeric for minSdk 23
                return "network";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "busy";
            case 12: // ERROR_LANGUAGE_NOT_SUPPORTED (API 31)
            case 13: // ERROR_LANGUAGE_UNAVAILABLE (API 31)
                return "language";
            default:
                return "failed";
        }
    }

    private void sendText(Bundle bundle, boolean isFinal) {
        ArrayList<String> matches = bundle == null
            ? null
            : bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches == null || matches.isEmpty()) return;
        JSObject event = new JSObject();
        event.put("text", matches.get(0));
        event.put("final", isFinal);
        notifyListeners("result", event);
    }

    private void finishSession() {
        destroyRecognizer();
        notifyListeners("end", new JSObject());
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) recognizer.stopListening();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyRecognizer();
        super.handleOnDestroy();
    }
}