package com.m.xiangqi;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 原生 Pikafish 引擎插件（必须在 super.onCreate 之前注册）
        registerPlugin(NativePikafishPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
