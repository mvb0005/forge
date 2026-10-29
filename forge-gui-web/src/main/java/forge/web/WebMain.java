package forge.web;

import forge.ImageKeys;
import forge.gamemodes.match.HostedMatch;
import forge.gui.GuiBase;
import forge.gui.download.GuiDownloadService;
import forge.gui.interfaces.IGuiBase;
import forge.gui.interfaces.IGuiGame;
import forge.item.PaperCard;
import forge.localinstance.properties.ForgeConstants;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.localinstance.skin.FSkinProp;
import forge.localinstance.skin.ISkinImage;
import forge.model.FModel;
import forge.sound.IAudioClip;
import forge.sound.IAudioMusic;
import forge.util.FSerializableFunction;
import forge.util.ImageFetcher;
import org.jupnp.UpnpServiceConfiguration;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.function.Consumer;

/**
 * Entry point of the web frontend: a headless Forge model plus a local HTTP/WebSocket server.
 * Run with the working directory set to forge-gui so Forge finds res/.
 */
public final class WebMain {
    private WebMain() {
    }

    public static void main(String[] args) throws Exception {
        System.setProperty("java.awt.headless", "true");

        int port = Integer.getInteger("forge.web.port", 7777);
        String bind = System.getProperty("forge.web.host", "127.0.0.1");
        String pics = System.getProperty("forge.web.pics");
        String ui = System.getProperty("forge.web.ui");
        for (int i = 0; i < args.length - 1; i++) {
            switch (args[i]) {
                case "--port" -> port = Integer.parseInt(args[++i]);
                case "--host" -> bind = args[++i];
                case "--pics" -> pics = args[++i];
                case "--ui" -> ui = args[++i];
                default -> { }
            }
        }

        Path cwd = Path.of("").toAbsolutePath().normalize();
        Path assets = Files.isDirectory(cwd.resolve("res")) ? cwd : cwd.resolve("forge-gui");
        Path repoRoot = assets.getParent() != null ? assets.getParent() : cwd;

        GuiBase.setInterface(new HeadlessGui(assets.toString() + File.separator));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.PLAYER_NAME, "You");
            prefs.setPref(FPref.UI_ENABLE_ONLINE_IMAGE_FETCHER, false);
            prefs.setPref(FPref.UI_ENABLE_SOUNDS, false);
            prefs.setPref(FPref.UI_ENABLE_MUSIC, false);
            prefs.setPref(FPref.UI_MATCHES_PER_GAME, "1");
            prefs.setPref(FPref.UI_SHOW_ACTIONABLE_HIGHLIGHTS, true);
            return null;
        });

        if (pics != null) {
            String root = new File(pics).getAbsolutePath() + File.separator;
            ImageKeys.initializeDirs(root + "cards" + File.separator, ForgeConstants.CACHE_CARD_PICS_SUBDIR,
                    root + "tokens" + File.separator, root + "icons" + File.separator,
                    root + "boosters" + File.separator, root + "fatpacks" + File.separator,
                    root + "boosterboxes" + File.separator, root + "precons" + File.separator,
                    root + "tournamentpacks" + File.separator);
            System.out.println("Card images from " + root);
        }

        Path uiDir = ui != null ? Path.of(ui) : repoRoot.resolve("forge-gui-web").resolve("ui").resolve("dist");
        AccessIdentity access = AccessIdentity.fromEnv();
        System.out.println(access == null ? "Play auth: open (a local seat, not a person)" : "Play auth: Cloudflare Access");
        MatchHost host = new MatchHost(repoRoot, access, PlayLog.open());
        WebServer server = new WebServer(port, Files.isDirectory(uiDir) ? uiDir : null, host);
        server.start(bind);
        System.out.println("Forge web listening on http://" + bind + ":" + port + "/ (ui: " + (Files.isDirectory(uiDir) ? uiDir : "none") + ")");
        server.awaitClose();
    }

    private static final class HeadlessGui implements IGuiBase {
        private final String assetsDir;

        private HeadlessGui(String assetsDir) {
            this.assetsDir = assetsDir;
        }

        @Override public boolean isRunningOnDesktop() { return true; }
        @Override public boolean isLibgdxPort() { return false; }
        @Override public String getCurrentVersion() { return "web"; }
        @Override public void invokeInEdtNow(Runnable runnable) { WebEdt.invokeNow(runnable); }
        @Override public void invokeInEdtLater(Runnable runnable) { WebEdt.invokeLater(runnable); }
        @Override public void invokeInEdtAndWait(Runnable proc) { WebEdt.invokeAndWait(proc); }
        @Override public void runBackgroundTask(String message, Runnable task) { new Thread(task, "Web background").start(); }
        @Override public boolean isGuiThread() { return WebEdt.isEdt(); }
        @Override public String getAssetsDir() { return assetsDir; }
        @Override public ImageFetcher getImageFetcher() { return null; }
        @Override public ISkinImage getSkinIcon(FSkinProp skinProp) { return null; }
        @Override public ISkinImage getUnskinnedIcon(String path) { return null; }
        @Override public ISkinImage getCardArt(PaperCard card, boolean backFace) { return null; }
        @Override public ISkinImage createLayeredImage(PaperCard card, FSkinProp background, String overlayFilename, float opacity) { return null; }
        @Override public void clearImageCache() { }
        @Override public String encodeSymbols(String str, boolean formatReminderText) { return str; }
        @Override public int getAvatarCount() { return 0; }
        @Override public int getSleevesCount() { return 0; }
        @Override public float getScreenScale() { return 1.0f; }
        @Override public void preventSystemSleep(boolean preventSleep) { }
        @Override public void download(GuiDownloadService service, Consumer<Boolean> callback) { callback.accept(false); }
        @Override public void copyToClipboard(String text) { }
        @Override public void browseToUrl(String url) { }
        @Override public void showCardList(String title, String message, List<PaperCard> list) { }
        @Override public boolean showBoxedProduct(String title, String message, List<PaperCard> list) { return false; }
        @Override public void showBugReportDialog(String title, String text, boolean showExitAppBtn) { System.err.println(title + "\n" + text); }
        @Override public void showImageDialog(ISkinImage image, String message, String title) { }
        @Override public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) { return defaultOption; }
        @Override public String showInputDialog(String message, String title, FSkinProp icon, String initialInput, List<String> inputOptions, boolean isNumeric) { return initialInput; }
        @Override public String showFileDialog(String title, String defaultDir) { return null; }
        @Override public File getSaveFile(File defaultFile) { return null; }
        @Override public <T> List<T> order(String title, String top, int remainingObjectsMin, int remainingObjectsMax, List<T> sourceChoices, List<T> destChoices) {
            List<T> result = new ArrayList<>();
            if (destChoices != null) {
                result.addAll(destChoices);
            }
            result.addAll(sourceChoices);
            return result;
        }
        @Override public <T> List<T> getChoices(String message, int min, int max, Collection<T> choices, Collection<T> selected, FSerializableFunction<T, String> display) {
            if (selected != null && !selected.isEmpty()) {
                return new ArrayList<>(selected);
            }
            List<T> result = new ArrayList<>();
            for (T t : choices) {
                if (result.size() >= Math.max(min, 0)) {
                    break;
                }
                result.add(t);
            }
            return result;
        }
        @Override public PaperCard chooseCard(String title, String message, List<PaperCard> list) { return list.isEmpty() ? null : list.get(0); }
        @Override public boolean isSupportedAudioFormat(File file) { return false; }
        @Override public IAudioClip createAudioClip(String filename) { return null; }
        @Override public IAudioMusic createAudioMusic(String filename) { return null; }
        @Override public void startAltSoundSystem(String filename, boolean isSynchronized) { }
        @Override public void showSpellShop() { }
        @Override public void showBazaar() { }
        @Override public IGuiGame getNewGuiGame() { return null; }
        @Override public HostedMatch hostMatch() { return null; }
        @Override public UpnpServiceConfiguration getUpnpPlatformService() { return null; }
        @Override public boolean hasNetGame() { return false; }
    }
}
