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
        String lang = call.getString("lang", "en-US");
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
                        String code = error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS
                            ? "permission"
                            : "failed";
                        JSObject event = new JSObject();
                        event.put("code", code);
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