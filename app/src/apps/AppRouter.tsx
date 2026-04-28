import type { FC } from 'react';
import AppPlaceholder from './AppPlaceholder';

// Real (functional) apps from the Kimi seed
import Settings from './Settings';
import FileManager from './FileManager';
import Terminal from './Terminal';
import SystemMonitor from './SystemMonitor';
import ArchiveManager from './ArchiveManager';
import Chat from './Chat';
import Browser from './Browser';
import Notes from './Notes';
import Todo from './Todo';
import Calendar from './Calendar';
import Calculator from './Calculator';
import Clock from './Clock';
import TextEditor from './TextEditor';
import DocumentViewer from './DocumentViewer';
import MarkdownPreview from './MarkdownPreview';
import ImageViewer from './ImageViewer';
import MusicPlayer from './MusicPlayer';
import VideoPlayer from './VideoPlayer';
import CodeEditor from './CodeEditor';

interface AppRouterProps {
  appId: string;
  windowId: string;
}

const AppRouter: FC<AppRouterProps> = ({ appId }) => {
  switch (appId) {
    // Tytus product surfaces — placeholder until their phase wires them up
    case 'pod-inspector':
    case 'channels':
    case 'help':
      return <AppPlaceholder appId={appId} />;

    // OS-feel apps (functional today; daemon integration later for some)
    case 'settings':
      return <Settings />;
    case 'filemanager':
      return <FileManager />;
    case 'terminal':
      return <Terminal />;
    case 'systemmonitor':
      return <SystemMonitor />;
    case 'archivemanager':
      return <ArchiveManager />;
    case 'chat':
      return <Chat />;
    case 'browser':
      return <Browser />;
    case 'notes':
      return <Notes />;
    case 'todo':
      return <Todo />;
    case 'calendar':
      return <Calendar />;
    case 'calculator':
      return <Calculator />;
    case 'clock':
      return <Clock />;
    case 'texteditor':
      return <TextEditor />;
    case 'documentviewer':
      return <DocumentViewer />;
    case 'markdownpreview':
      return <MarkdownPreview />;
    case 'imageviewer':
      return <ImageViewer />;
    case 'musicplayer':
      return <MusicPlayer />;
    case 'videoplayer':
      return <VideoPlayer />;
    case 'codeeditor':
      return <CodeEditor />;
    default:
      return <AppPlaceholder appId={appId} />;
  }
};

export default AppRouter;
