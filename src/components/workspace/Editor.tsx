import * as React from 'react';
import AceEditor, { IAnnotation } from 'react-ace';
import { HotKeys } from 'react-hotkeys';
import sharedbAce from 'sharedb-ace';

import 'ace-builds/src-noconflict/ext-language_tools';
import 'ace-builds/src-noconflict/ext-searchbox';
import { HighlightRulesSelector, ModeSelector } from 'js-slang/dist/editors/ace/modes/source';
import 'js-slang/dist/editors/ace/theme/source';
import { LINKS } from '../../utils/constants';
import { checkSessionIdExists } from './collabEditing/helper';

/**
 * @property editorValue - The string content of the react-ace editor
 * @property handleEditorChange  - A callback function
 *           for the react-ace editor's `onChange`
 * @property handleEvalEditor  - A callback function for evaluation
 *           of the editor's content, using `slang`
 */

export interface IEditorProps {
  breakpoints: string[];
  editorSessionId: string;
  editorValue: string;
  highlightedLines: number[][];
  isEditorAutorun: boolean;
  sharedbAceInitValue?: string;
  sharedbAceIsInviting?: boolean;
  sourceChapter?: number;
  handleEditorEval: () => void;
  handleEditorValueChange: (newCode: string) => void;
  handleEditorUpdateBreakpoints: (breakpoints: string[]) => void;
  handleFinishInvite?: () => void;
  handleSetWebsocketStatus?: (websocketStatus: number) => void;
  handleUpdateHasUnsavedChanges?: (hasUnsavedChanges: boolean) => void;
}

class Editor extends React.PureComponent<IEditorProps, {}> {
  public ShareAce: any;
  public AceEditor: React.RefObject<AceEditor>;
  private onChangeMethod: (newCode: string) => void;
  private onValidateMethod: (annotations: IAnnotation[]) => void;

  constructor(props: IEditorProps) {
    super(props);
    this.AceEditor = React.createRef();
    this.ShareAce = null;
    this.onChangeMethod = (newCode: string) => {
      if (this.props.handleUpdateHasUnsavedChanges) {
        this.props.handleUpdateHasUnsavedChanges(true);
      }
      this.props.handleEditorValueChange(newCode);
    };
    this.onValidateMethod = (annotations: IAnnotation[]) => {
      if (this.props.isEditorAutorun && annotations.length === 0) {
        this.props.handleEditorEval();
      }
    };
  }

  public getBreakpoints() {
    const breakpoints = (this.AceEditor.current as any).editor.session.$breakpoints;
    const res = [];
    for (let i = 0; i < breakpoints.length; i++) {
      if (breakpoints[i] != null) {
        res.push(i);
      }
    }
    return res;
  }

  public componentDidMount() {
    if (!this.AceEditor.current) {
      return;
    }
    const editor = (this.AceEditor.current as any).editor;
    const session = editor.getSession();

    /* disable error threshold incrementer

    const jshintOptions = {
      // undef: true,
      // unused: true,
      esnext: true,
      moz: true,
      devel: true,
      browser: true,
      node: true,
      laxcomma: true,
      laxbreak: true,
      lastsemic: true,
      onevar: false,
      passfail: false,
      maxerr: 1000,
      expr: true,
      multistr: true,
      globalstrict: true
    };
    session.$worker.send('setOptions', [jshintOptions]);

    */

    // navigation on key press
    editor.commands.addCommand({
      name: 'myCommand',
      bindKey: { win: 'Ctrl-B', mac: 'Command-B' },
      exec: this.handleNavigation
    });

    editor.on('gutterclick', this.handleGutterClick);

    // Change all info annotations to error annotations
    session.on('changeAnnotation', this.handleAnnotationChange(session));

    // Has session ID
    if (this.props.editorSessionId !== '') {
      this.handleStartCollabEditing(editor);
    }
  }

  public componentWillUnmount() {
    if (this.ShareAce !== null) {
      // Umounting... Closing websocket
      this.ShareAce.WS.close();
    }
    this.ShareAce = null;
  }

  public getMarkers = () => {
    const markerProps = [];
    for (const lineNum of this.props.highlightedLines) {
      markerProps.push({
        startRow: lineNum[0],
        startCol: 0,
        endRow: lineNum[1],
        endCol: 1,
        className: 'myMarker',
        type: 'fullLine'
      });
    }
    return markerProps;
  };

  // chapter selector used to choose the correct source mode
  public chapterNo = () => {
    let chapter = this.props.sourceChapter;
    if (chapter === undefined) {
      chapter = 1;
    }
    HighlightRulesSelector(chapter);
    ModeSelector(chapter);
    return 'source' + chapter.toString();
  };

  public render() {
    return (
      <HotKeys className="Editor" handlers={handlers}>
        <div className="row editor-react-ace">
          <AceEditor
            className="react-ace"
            commands={[
              {
                name: 'evaluate',
                bindKey: {
                  win: 'Shift-Enter',
                  mac: 'Shift-Enter'
                },
                exec: this.props.handleEditorEval
              }
            ]}
            editorProps={{
              $blockScrolling: Infinity
            }}
            ref={this.AceEditor}
            markers={this.getMarkers()}
            fontSize={17}
            height="100%"
            highlightActiveLine={false}
            mode={this.chapterNo()} // select according to props.sourceChapter
            onChange={this.onChangeMethod}
            onValidate={this.onValidateMethod}
            theme="source"
            value={this.props.editorValue}
            width="100%"
            setOptions={{
              fontFamily: "'Inconsolata', 'Consolas', monospace"
            }}
          />
        </div>
      </HotKeys>
    );
  }

  private handleNavigation = (editor: any) => {
    const chapter = this.props.sourceChapter;
    const pos = editor.selection.getCursor();
    const token = editor.session.getTokenAt(pos.row, pos.column);
    const url = LINKS.TEXTBOOK;
    if (token !== null && /\bsupport.function\b/.test(token.type)) {
      window.open(`${url}/source/source_${chapter}/global.html#${token.value}`); // opens the link
    } else if (token !== null && /\bstorage.type\b/.test(token.type)) {
      window.open(`${url}/source/source_${chapter}.pdf`);
    }
  };

  private handleGutterClick = (e: any) => {
    const target = e.domEvent.target;
    if (
      target.className.indexOf('ace_gutter-cell') === -1 ||
      !e.editor.isFocused() ||
      e.clientX > 35 + target.getBoundingClientRect().left
    ) {
      return;
    }

    const row = e.getDocumentPosition().row;
    const content = e.editor.session.getLine(row);
    const breakpoints = e.editor.session.getBreakpoints(row, 0);
    if (
      breakpoints[row] === undefined &&
      content.length !== 0 &&
      !content.includes('//') &&
      !content.includes('debugger;')
    ) {
      e.editor.session.setBreakpoint(row);
    } else {
      e.editor.session.clearBreakpoint(row);
    }
    e.stop();
    this.props.handleEditorUpdateBreakpoints(e.editor.session.$breakpoints);
  };

  private handleAnnotationChange = (session: any) => () => {
    const annotations = session.getAnnotations();
    let count = 0;
    for (const anno of annotations) {
      if (anno.type === 'info') {
        anno.type = 'error';
        anno.className = 'ace_error';
        count++;
      }
    }
    if (count !== 0) {
      session.setAnnotations(annotations);
    }
  };

  private handleStartCollabEditing = (editor: any) => {
    const ShareAce = new sharedbAce(this.props.editorSessionId!, {
      WsUrl: 'wss://' + LINKS.SHAREDB_SERVER + 'ws/',
      pluginWsUrl: null,
      namespace: 'codepad'
    });
    this.ShareAce = ShareAce;
    ShareAce.on('ready', () => {
      ShareAce.add(
        editor,
        ['code'],
        [
          // SharedbAceRWControl,
          // SharedbAceMultipleCursors
        ]
      );
      if (this.props.sharedbAceIsInviting) {
        this.props.handleEditorValueChange(this.props.sharedbAceInitValue!);
        this.props.handleFinishInvite!();
      }
    });

    // WebSocket connection status detection logic
    const WS = ShareAce.WS;
    let interval: any;
    const sessionIdNotFound = () => {
      clearInterval(interval);
      WS.close();
    };
    const cannotReachServer = () => {
      WS.reconnect();
    };
    const checkStatus = () => {
      if (this.ShareAce === null) {
        return;
      }
      checkSessionIdExists(
        this.props.editorSessionId,
        () => {},
        sessionIdNotFound,
        cannotReachServer
      );
    };
    // Checks connection status every 5sec
    interval = setInterval(checkStatus, 5000);

    WS.addEventListener('open', (event: Event) => {
      this.props.handleSetWebsocketStatus!(1);
    });
    WS.addEventListener('close', (event: Event) => {
      this.props.handleSetWebsocketStatus!(0);
    });
  };
}

/* Override handler, so does not trigger when focus is in editor */
const handlers = {
  goGreen: () => {}
};

export default Editor;
