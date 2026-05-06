import type { FC } from 'react';
import AppPlaceholder from './AppPlaceholder';
import AutoInstallApp from './AutoInstallApp';
import WorkspaceAppHost from './WorkspaceAppHost';
import { useInstalledAppIds } from '@/runtime/hooks/use-installed-app-ids';
import { FEATURED_APPS } from './featured-apps-catalog';
import { LEGACY_APP_ID_ALIASES } from './legacy-app-aliases';

// Tytus product surfaces
import PodInspector from './PodInspector';
import Help from './Help';
import Channels from './Channels';
import AppStore from './AppStore';

// System
import Settings from './Settings';
import FileManager from './FileManager';
import Terminal from './Terminal';
import SystemMonitor from './SystemMonitor';
import ArchiveManager from './ArchiveManager';

// Internet
import Chat from './Chat';
import Browser from './Browser';
import Weather from './Weather';
import RssReader from './RssReader';

// Productivity
import Todo from './Todo';
import Reminders from './Reminders';
import Calendar from './Calendar';
import Calculator from './Calculator';
import Clock from './Clock';
import DocumentViewer from './DocumentViewer';
// MarkdownPreview lifted to @tytus/app-markdown-preview workspace package (Phase 5).

// Media
import ImageViewer from './ImageViewer';
import ImageGallery from './ImageGallery';
// PhotoEditor lifted to @tytus/app-photo-editor workspace package (Phase 5).
import MusicCreator from './MusicCreator';
import VideoPlayer from './VideoPlayer';
import ScreenRecorder from './ScreenRecorder';
import MediaConverter from './MediaConverter';

// DevTools
// CodeEditor lifted to @tytus/app-code-editor workspace package (Phase 5).
// ApiTester lifted to @tytus/app-api-tester workspace package (Phase 5).
import JsonFormatter from './JsonFormatter';
import RegexTester from './RegexTester';
import Base64Tool from './Base64Tool';
import ColorPalette from './ColorPalette';

// Creative
import Drawing from './Drawing';
import Whiteboard from './Whiteboard';
import ColorPicker from './ColorPicker';
import AsciiArt from './AsciiArt';
import MatrixRain from './MatrixRain';

// Games
import Minesweeper from './Minesweeper';
import Snake from './Snake';
import Tetris from './Tetris';
import TicTacToe from './TicTacToe';
import Game2048 from './Game2048';
import Sudoku from './Sudoku';
import Chess from './Chess';
import Memory from './Memory';
import Pong from './Pong';
import Solitaire from './Solitaire';
import FlappyBird from './FlappyBird';

interface AppRouterProps {
  appId: string;
  windowId: string;
}

/**
 * Boot-time hint of app ids whose entry lives in a workspace package
 * (loaded via the dynamic loader → installed_apps row → @tytus/app-<id>
 * import). The runtime source of truth is the live `installed_apps`
 * table, consulted via `useInstalledAppIds()` below — this Set only
 * exists as a SSR / pre-DB-init fast path so a freshly opened window
 * doesn't flash a placeholder while the SQLite worker boots.
 *
 * Adding an id here is optional once the row is being seeded; the
 * router will still mount `WorkspaceAppHost` for any kind∈{bundled,
 * installed} row regardless of whether its id appears here.
 *
 * The legacy in-tree apps under different ids (e.g. `musiccreator`,
 * `musicplayer`, `voicerecorder`, `spreadsheet`, `notes`,
 * `texteditor`) keep their direct mount through the static switch
 * below — this is the dual-source transition path until the cleanup
 * PR removes the in-tree files.
 */
const WORKSPACE_APP_IDS_HINT = new Set([
  // System apps (bundled with shell). Forge and user apps live at
  // github.com/traylinx/tytus-app-* and ship as kind='installed' rows
  // via App Store → Featured (or Install from URL); they do NOT
  // appear in the boot seed and don't need a hint here.
  'memo',
  'music-player',
  'sheet',
  'studio',
  'voice-recorder',
]);

// LEGACY_APP_ID_ALIASES is the source of truth for legacy → canonical
// id mapping; lives in `./legacy-app-aliases` so AppLauncher (recents
// dedupe) and AppRouter (mount routing) share one map without circular
// imports.

const AppRouter: FC<AppRouterProps> = ({ appId }) => {
  const canonical = LEGACY_APP_ID_ALIASES[appId] ?? appId;

  // DEV-ONLY: short-circuit juli3ta to the in-tree MusicCreator so
  // edits to `app/src/apps/MusicCreator.tsx` are immediately visible
  // in the local dev server. In production, the workspace-host path
  // below loads the published `tytus-app-juli3ta@<tag>` bundle from
  // jsdelivr. Remove this block once the standalone repo's next
  // release is cut and the jsdelivr cache is refreshed.
  if (import.meta.env.DEV && canonical === 'juli3ta') {
    return <MusicCreator />;
  }

  // Dynamic-loader path — source of truth is the live installed_apps
  // table. A row with kind ∈ {'bundled', 'installed'} mounts via
  // WorkspaceAppHost regardless of whether the id is in the hint Set.
  // This makes third-party apps installed at runtime ("Install from
  // URL" → e.g. `todoist`) openable, which the Phase-3 v1 was missing
  // (the static Set only knew the 11 build-time ids).
  const installedIds = useInstalledAppIds();
  const installedKind = installedIds.get(canonical);
  if (installedKind === 'bundled' || installedKind === 'installed') {
    return <WorkspaceAppHost appId={canonical} />;
  }

  // Fast path for first-render before the DB load resolves (the hint
  // Set encodes the build-time bundled ids, so we don't flash an
  // AppPlaceholder for them while the live map is still empty).
  if (installedIds.size === 0 && WORKSPACE_APP_IDS_HINT.has(canonical)) {
    return <WorkspaceAppHost appId={canonical} />;
  }

  // Auto-install path — the launcher advertises carved-out user apps
  // (markdown-preview, photo-editor, etc.) but they're not seeded as
  // bundled rows. If the canonical id matches a Featured catalog entry
  // and the live DB has loaded (so we know it's not a transient empty
  // state), kick off an in-place install. After install the
  // useInstalledAppIds map flips, this component re-renders, and we
  // hit the WorkspaceAppHost branch above.
  if (installedIds.size > 0) {
    const catalogEntry = FEATURED_APPS.find((a) => a.id === canonical);
    if (catalogEntry) {
      return <AutoInstallApp appId={canonical} catalogEntry={catalogEntry} />;
    }
  }

  switch (appId) {
    case 'app-store': return <AppStore />;
    case 'pod-inspector': return <PodInspector />;
    case 'help': return <Help />;

    // Tytus product surfaces — placeholder until their phase wires them up
    case 'channels':
      return <Channels />;

    // System
    case 'settings': return <Settings />;
    case 'filemanager': return <FileManager />;
    case 'terminal': return <Terminal />;
    case 'systemmonitor': return <SystemMonitor />;
    case 'archivemanager': return <ArchiveManager />;

    // Internet
    case 'chat': return <Chat />;
    case 'browser': return <Browser />;
    case 'weather': return <Weather />;
    case 'rssreader': return <RssReader />;

    // Productivity
    // 'notes' is aliased to 'memo' above and routed via dynamic loader
    case 'todo': return <Todo />;
    case 'reminders': return <Reminders />;
    case 'calendar': return <Calendar />;
    case 'calculator': return <Calculator />;
    case 'clock': return <Clock />;
    // 'spreadsheet' aliased to 'sheet'; 'texteditor' aliased to 'text-editor' workspace package (Phase 5)
    case 'documentviewer': return <DocumentViewer />;
    // 'markdownpreview' aliased to 'markdown-preview' workspace package (Phase 5)

    // Media
    case 'imageviewer': return <ImageViewer />;
    case 'imagegallery': return <ImageGallery />;
    // 'photoeditor' aliased to 'photo-editor' workspace package (Phase 5)
    // 'musicplayer' aliased to 'music-player' above
    case 'musiccreator': return <MusicCreator />;
    case 'videoplayer': return <VideoPlayer />;
    // 'voicerecorder' aliased to 'voice-recorder' above
    case 'screenrecorder': return <ScreenRecorder />;
    case 'mediaconverter': return <MediaConverter />;

    // DevTools
    // 'codeeditor' aliased to 'code-editor' workspace package (Phase 5)
    // 'apitester' aliased to 'api-tester' workspace package (Phase 5)
    case 'jsonformatter': return <JsonFormatter />;
    case 'regextester': return <RegexTester />;
    case 'base64tool': return <Base64Tool />;
    case 'colorpalette': return <ColorPalette />;

    // Creative
    case 'drawing': return <Drawing />;
    case 'whiteboard': return <Whiteboard />;
    case 'colorpicker': return <ColorPicker />;
    case 'asciiart': return <AsciiArt />;
    case 'matrixrain': return <MatrixRain />;

    // Games
    case 'minesweeper': return <Minesweeper />;
    case 'snake': return <Snake />;
    case 'tetris': return <Tetris />;
    case 'tictactoe': return <TicTacToe />;
    case 'game2048': return <Game2048 />;
    case 'sudoku': return <Sudoku />;
    case 'chess': return <Chess />;
    case 'memory': return <Memory />;
    case 'pong': return <Pong />;
    case 'solitaire': return <Solitaire />;
    case 'flappybird': return <FlappyBird />;

    default:
      return <AppPlaceholder appId={appId} />;
  }
};

export default AppRouter;
