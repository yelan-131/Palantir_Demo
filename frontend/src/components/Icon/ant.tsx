import { forwardRef, type HTMLAttributes } from 'react';
import {
  Ban, Bell, BookOpen, Bot, Boxes, Calendar, Car, ChartCandlestick, ChartColumn, ChartLine, ChartPie, Check, ChevronDown,
  ChevronLeft, ChevronRight, CircleCheck, CircleChevronDown, CircleDollarSign, CircleHelp, CirclePause, CirclePlay, CircleX,
  ClipboardList, Clock, CloudUpload, Code, Copy, CornerUpLeft, Crosshair, Database, Download, Ellipsis, EllipsisVertical,
  Expand, ExternalLink, Eye, FileCheck, FileCheck2, FileImage, FileLock, FilePenLine, FileSearch, FileText, FlaskConical,
  Folder, FolderPlus, Funnel, Gauge, GitBranch, GitFork, Globe, Grid2x2Plus, GripVertical, Hash, Heart, History, House, IdCard,
  Import, Inbox, Info, KeyRound, Landmark, Layers, LayoutGrid, Lightbulb, Link, List, ListOrdered, LoaderCircle, LockKeyhole,
  Mail, Menu, MessageSquare, Monitor, Move, Network, Palette, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Paperclip, Pencil,
  Pin, Plug, Plus, Power, Redo2, RefreshCw, RotateCw, Save, Search, Send, Settings, Share2, ShieldCheck, ShoppingCart, Shrink,
  Siren, SlidersHorizontal, Split, SquareCheck, SquareKanban, SquareMousePointer, Star, Store, Table2, Tag, Tags, TextAlignStart,
  Timer, Trash2, TriangleAlert, Trophy, Type, Undo2, Upload, UserCog, UserRound, Users, Waypoints, Workflow, Wrench, X, Zap,
  ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUp, ArrowUpNarrowWide,
  type LucideIcon,
} from 'lucide-react';

/* Drop-in replacements for the @ant-design/icons components this app used. They keep the `anticon`
   class and 1em sizing, so Ant components and existing font-size rules lay them out unchanged. */
export interface AntIconProps extends HTMLAttributes<HTMLSpanElement> {
  spin?: boolean;
  rotate?: number;
}

type Fill = 'solid' | 'knockout';

function lucideIcon(Svg: LucideIcon, name: string, fill?: Fill, spinByDefault = false) {
  const Component = forwardRef<HTMLSpanElement, AntIconProps>(({ spin = spinByDefault, rotate, className, ...rest }, ref) => (
    <span
      ref={ref}
      role="img"
      aria-hidden={rest['aria-label'] ? undefined : true}
      {...rest}
      className={`anticon ui-icon${spin ? ' ui-icon-spin' : ''}${className ? ` ${className}` : ''}`}
    >
      <Svg
        width="1em"
        height="1em"
        strokeWidth={1.75}
        aria-hidden="true"
        focusable="false"
        fill={fill ? 'currentColor' : 'none'}
        color={fill === 'knockout' ? 'var(--canon-surface, #fff)' : 'currentColor'}
        style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
      />
    </span>
  ));
  Component.displayName = name;
  return Component;
}

export const AimOutlined = lucideIcon(Crosshair, 'AimOutlined');
export const AlertOutlined = lucideIcon(Siren, 'AlertOutlined');
export const AlignLeftOutlined = lucideIcon(TextAlignStart, 'AlignLeftOutlined');
export const ApartmentOutlined = lucideIcon(Network, 'ApartmentOutlined');
export const ApiOutlined = lucideIcon(Plug, 'ApiOutlined');
export const AppstoreAddOutlined = lucideIcon(Grid2x2Plus, 'AppstoreAddOutlined');
export const AppstoreOutlined = lucideIcon(LayoutGrid, 'AppstoreOutlined');
export const ArrowDownOutlined = lucideIcon(ArrowDown, 'ArrowDownOutlined');
export const ArrowLeftOutlined = lucideIcon(ArrowLeft, 'ArrowLeftOutlined');
export const ArrowRightOutlined = lucideIcon(ArrowRight, 'ArrowRightOutlined');
export const ArrowUpOutlined = lucideIcon(ArrowUp, 'ArrowUpOutlined');
export const AuditOutlined = lucideIcon(FileCheck, 'AuditOutlined');
export const BankOutlined = lucideIcon(Landmark, 'BankOutlined');
export const BarChartOutlined = lucideIcon(ChartColumn, 'BarChartOutlined');
export const BellOutlined = lucideIcon(Bell, 'BellOutlined');
export const BookOutlined = lucideIcon(BookOpen, 'BookOutlined');
export const BranchesOutlined = lucideIcon(GitBranch, 'BranchesOutlined');
export const BulbOutlined = lucideIcon(Lightbulb, 'BulbOutlined');
export const CalendarOutlined = lucideIcon(Calendar, 'CalendarOutlined');
export const CarOutlined = lucideIcon(Car, 'CarOutlined');
export const CheckCircleFilled = lucideIcon(CircleCheck, 'CheckCircleFilled', 'knockout');
export const CheckCircleOutlined = lucideIcon(CircleCheck, 'CheckCircleOutlined');
export const CheckOutlined = lucideIcon(Check, 'CheckOutlined');
export const CheckSquareOutlined = lucideIcon(SquareCheck, 'CheckSquareOutlined');
export const ClockCircleOutlined = lucideIcon(Clock, 'ClockCircleOutlined');
export const CloseCircleFilled = lucideIcon(CircleX, 'CloseCircleFilled', 'knockout');
export const CloseCircleOutlined = lucideIcon(CircleX, 'CloseCircleOutlined');
export const CloseOutlined = lucideIcon(X, 'CloseOutlined');
export const CloudUploadOutlined = lucideIcon(CloudUpload, 'CloudUploadOutlined');
export const CodeOutlined = lucideIcon(Code, 'CodeOutlined');
export const CompressOutlined = lucideIcon(Shrink, 'CompressOutlined');
export const ControlOutlined = lucideIcon(SlidersHorizontal, 'ControlOutlined');
export const CopyOutlined = lucideIcon(Copy, 'CopyOutlined');
export const DashboardOutlined = lucideIcon(Gauge, 'DashboardOutlined');
export const DatabaseOutlined = lucideIcon(Database, 'DatabaseOutlined');
export const DeleteOutlined = lucideIcon(Trash2, 'DeleteOutlined');
export const DeploymentUnitOutlined = lucideIcon(Boxes, 'DeploymentUnitOutlined');
export const DesktopOutlined = lucideIcon(Monitor, 'DesktopOutlined');
export const DollarOutlined = lucideIcon(CircleDollarSign, 'DollarOutlined');
export const DownCircleOutlined = lucideIcon(CircleChevronDown, 'DownCircleOutlined');
export const DownloadOutlined = lucideIcon(Download, 'DownloadOutlined');
export const DownOutlined = lucideIcon(ChevronDown, 'DownOutlined');
export const DragOutlined = lucideIcon(Move, 'DragOutlined');
export const EditOutlined = lucideIcon(Pencil, 'EditOutlined');
export const EllipsisOutlined = lucideIcon(Ellipsis, 'EllipsisOutlined');
export const ExpandOutlined = lucideIcon(Expand, 'ExpandOutlined');
export const ExperimentOutlined = lucideIcon(FlaskConical, 'ExperimentOutlined');
export const ExportOutlined = lucideIcon(ExternalLink, 'ExportOutlined');
export const EyeOutlined = lucideIcon(Eye, 'EyeOutlined');
export const FieldTimeOutlined = lucideIcon(Timer, 'FieldTimeOutlined');
export const FileDoneOutlined = lucideIcon(FileCheck2, 'FileDoneOutlined');
export const FileImageOutlined = lucideIcon(FileImage, 'FileImageOutlined');
export const FileProtectOutlined = lucideIcon(FileLock, 'FileProtectOutlined');
export const FileSearchOutlined = lucideIcon(FileSearch, 'FileSearchOutlined');
export const FileTextOutlined = lucideIcon(FileText, 'FileTextOutlined');
export const FilterOutlined = lucideIcon(Funnel, 'FilterOutlined');
export const FolderAddOutlined = lucideIcon(FolderPlus, 'FolderAddOutlined');
export const FolderOutlined = lucideIcon(Folder, 'FolderOutlined');
export const FontSizeOutlined = lucideIcon(Type, 'FontSizeOutlined');
export const ForkOutlined = lucideIcon(GitFork, 'ForkOutlined');
export const FormOutlined = lucideIcon(FilePenLine, 'FormOutlined');
export const GatewayOutlined = lucideIcon(Waypoints, 'GatewayOutlined');
export const GlobalOutlined = lucideIcon(Globe, 'GlobalOutlined');
export const HeartOutlined = lucideIcon(Heart, 'HeartOutlined');
export const HistoryOutlined = lucideIcon(History, 'HistoryOutlined');
export const HolderOutlined = lucideIcon(GripVertical, 'HolderOutlined');
export const HomeOutlined = lucideIcon(House, 'HomeOutlined');
export const ImportOutlined = lucideIcon(Import, 'ImportOutlined');
export const InboxOutlined = lucideIcon(Inbox, 'InboxOutlined');
export const InfoCircleOutlined = lucideIcon(Info, 'InfoCircleOutlined');
export const KeyOutlined = lucideIcon(KeyRound, 'KeyOutlined');
export const LayoutOutlined = lucideIcon(PanelsTopLeft, 'LayoutOutlined');
export const LeftOutlined = lucideIcon(ChevronLeft, 'LeftOutlined');
export const LineChartOutlined = lucideIcon(ChartLine, 'LineChartOutlined');
export const LinkOutlined = lucideIcon(Link, 'LinkOutlined');
export const LoadingOutlined = lucideIcon(LoaderCircle, 'LoadingOutlined', undefined, true);
export const LockOutlined = lucideIcon(LockKeyhole, 'LockOutlined');
export const MailOutlined = lucideIcon(Mail, 'MailOutlined');
export const MenuFoldOutlined = lucideIcon(PanelLeftClose, 'MenuFoldOutlined');
export const MenuOutlined = lucideIcon(Menu, 'MenuOutlined');
export const MenuUnfoldOutlined = lucideIcon(PanelLeftOpen, 'MenuUnfoldOutlined');
export const MessageOutlined = lucideIcon(MessageSquare, 'MessageOutlined');
export const MoreOutlined = lucideIcon(EllipsisVertical, 'MoreOutlined');
export const NodeIndexOutlined = lucideIcon(Workflow, 'NodeIndexOutlined');
export const NumberOutlined = lucideIcon(Hash, 'NumberOutlined');
export const OrderedListOutlined = lucideIcon(ListOrdered, 'OrderedListOutlined');
export const PaperClipOutlined = lucideIcon(Paperclip, 'PaperClipOutlined');
export const PartitionOutlined = lucideIcon(Split, 'PartitionOutlined');
export const PauseCircleOutlined = lucideIcon(CirclePause, 'PauseCircleOutlined');
export const PieChartOutlined = lucideIcon(ChartPie, 'PieChartOutlined');
export const PlayCircleOutlined = lucideIcon(CirclePlay, 'PlayCircleOutlined');
export const PlusOutlined = lucideIcon(Plus, 'PlusOutlined');
export const PoweroffOutlined = lucideIcon(Power, 'PoweroffOutlined');
export const ProfileOutlined = lucideIcon(IdCard, 'ProfileOutlined');
export const ProjectOutlined = lucideIcon(SquareKanban, 'ProjectOutlined');
export const PushpinOutlined = lucideIcon(Pin, 'PushpinOutlined');
export const QuestionCircleOutlined = lucideIcon(CircleHelp, 'QuestionCircleOutlined');
export const RedoOutlined = lucideIcon(Redo2, 'RedoOutlined');
export const ReloadOutlined = lucideIcon(RotateCw, 'ReloadOutlined');
export const RightOutlined = lucideIcon(ChevronRight, 'RightOutlined');
export const RobotOutlined = lucideIcon(Bot, 'RobotOutlined');
export const RollbackOutlined = lucideIcon(CornerUpLeft, 'RollbackOutlined');
export const SafetyCertificateOutlined = lucideIcon(ShieldCheck, 'SafetyCertificateOutlined');
export const SaveOutlined = lucideIcon(Save, 'SaveOutlined');
export const SearchOutlined = lucideIcon(Search, 'SearchOutlined');
export const SelectOutlined = lucideIcon(SquareMousePointer, 'SelectOutlined');
export const SendOutlined = lucideIcon(Send, 'SendOutlined');
export const SettingOutlined = lucideIcon(Settings, 'SettingOutlined');
export const ShareAltOutlined = lucideIcon(Share2, 'ShareAltOutlined');
export const ShopOutlined = lucideIcon(Store, 'ShopOutlined');
export const ShoppingCartOutlined = lucideIcon(ShoppingCart, 'ShoppingCartOutlined');
export const SkinOutlined = lucideIcon(Palette, 'SkinOutlined');
export const SnippetsOutlined = lucideIcon(ClipboardList, 'SnippetsOutlined');
export const SortAscendingOutlined = lucideIcon(ArrowUpNarrowWide, 'SortAscendingOutlined');
export const StarFilled = lucideIcon(Star, 'StarFilled', 'solid');
export const StarOutlined = lucideIcon(Star, 'StarOutlined');
export const StockOutlined = lucideIcon(ChartCandlestick, 'StockOutlined');
export const StopOutlined = lucideIcon(Ban, 'StopOutlined');
export const SwapOutlined = lucideIcon(ArrowLeftRight, 'SwapOutlined');
export const SwitcherOutlined = lucideIcon(Layers, 'SwitcherOutlined');
export const SyncOutlined = lucideIcon(RefreshCw, 'SyncOutlined');
export const TableOutlined = lucideIcon(Table2, 'TableOutlined');
export const TagOutlined = lucideIcon(Tag, 'TagOutlined');
export const TagsOutlined = lucideIcon(Tags, 'TagsOutlined');
export const TeamOutlined = lucideIcon(Users, 'TeamOutlined');
export const ThunderboltOutlined = lucideIcon(Zap, 'ThunderboltOutlined');
export const ToolOutlined = lucideIcon(Wrench, 'ToolOutlined');
export const TrophyOutlined = lucideIcon(Trophy, 'TrophyOutlined');
export const UndoOutlined = lucideIcon(Undo2, 'UndoOutlined');
export const UnorderedListOutlined = lucideIcon(List, 'UnorderedListOutlined');
export const UploadOutlined = lucideIcon(Upload, 'UploadOutlined');
export const UserOutlined = lucideIcon(UserRound, 'UserOutlined');
export const UserSwitchOutlined = lucideIcon(UserCog, 'UserSwitchOutlined');
export const WarningOutlined = lucideIcon(TriangleAlert, 'WarningOutlined');
