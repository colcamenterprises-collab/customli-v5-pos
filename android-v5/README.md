# Customli V5 POS — Direct Android Bluetooth

Dedicated Android Capacitor container package `io.customli.v5pos`, separate from the old POS (`io.customli.pos`). It opens https://customli.io/v5/ and does not run the old POS.

## Connection and printing
- Direct Android Bluetooth Classic SPP / ESC-POS receipt printers (58 mm and 80 mm).
- Android Nearby Devices permission, discover paired and unpaired devices, native pairing prompt.
- Find → select → Connect & Save → Test. Printer identity and paper width are stored on this tablet.
- The socket is opened only for printing/tests and always released so other POS or delivery apps can use the printer.
- A paid receipt is rasterised through V5 Receipt Studio via the authenticated POST /v5/api/print/native-receipt endpoint. The POS explicitly says bytes sent is not proof of paper output.
- No automatic printing is enabled at this stage. The Android V5 POS shows a Bluetooth printer icon and Print receipt on the paid receipt modal.

## Build
Requires Android SDK 35, JDK 17+, Android Capacitor 7 dependencies. From android-v5 run:

```bash
CAPACITOR_ANDROID_DIR=/path/to/node_modules/@capacitor/android/capacitor ./gradlew assembleDebug
```

Debug APK is signed with the Android debug key **for test installation only**. A production-signed APK requires an independently managed persistent V5 production signing keystore.

## Hardware acceptance pending
The isolated tests validate discovery/connect/save/test and receipt raster generation. Physical pairing, paper printing (especially Thai characters and modifiers), Bluetooth coexistence with Grab/Loyverse, and cash drawer controls have not been tested on hardware. No production-hardware acceptance is claimed.
