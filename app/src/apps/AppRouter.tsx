import type { FC } from 'react';
import AppPlaceholder from './AppPlaceholder';

// Tytus product surfaces
import PodInspector from './PodInspector';

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
import Notes from './Notes';
import Todo from './Todo';
import Reminders from './Reminders';
import Calendar from './Calendar';
import Calculator from './Calculator';
import Clock from './Clock';
import Spreadsheet from './Spreadsheet';
import TextEditor from './TextEditor';
import DocumentViewer from './DocumentViewer';
import MarkdownPreview from './MarkdownPreview';

// Media
import ImageViewer from './ImageViewer';
import ImageGallery from './ImageGallery';
import PhotoEditor from './PhotoEditor';
import MusicPlayer from './MusicPlayer';
import VideoPlayer from './VideoPlayer';
import VoiceRecorder from './VoiceRecorder';
import ScreenRecorder from './ScreenRecorder';
import MediaConverter from './MediaConverter';

// DevTools
import CodeEditor from './CodeEditor';
import ApiTester from './ApiTester';
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

const AppRouter: FC<AppRouterProps> = ({ appId }) => {
  switch (appId) {
    case 'pod-inspector': return <PodInspector />;

    // Tytus product surfaces — placeholder until their phase wires them up
    case 'channels':
    case 'help':
      return <AppPlaceholder appId={appId} />;

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
    case 'notes': return <Notes />;
    case 'todo': return <Todo />;
    case 'reminders': return <Reminders />;
    case 'calendar': return <Calendar />;
    case 'calculator': return <Calculator />;
    case 'clock': return <Clock />;
    case 'spreadsheet': return <Spreadsheet />;
    case 'texteditor': return <TextEditor />;
    case 'documentviewer': return <DocumentViewer />;
    case 'markdownpreview': return <MarkdownPreview />;

    // Media
    case 'imageviewer': return <ImageViewer />;
    case 'imagegallery': return <ImageGallery />;
    case 'photoeditor': return <PhotoEditor />;
    case 'musicplayer': return <MusicPlayer />;
    case 'videoplayer': return <VideoPlayer />;
    case 'voicerecorder': return <VoiceRecorder />;
    case 'screenrecorder': return <ScreenRecorder />;
    case 'mediaconverter': return <MediaConverter />;

    // DevTools
    case 'codeeditor': return <CodeEditor />;
    case 'apitester': return <ApiTester />;
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
