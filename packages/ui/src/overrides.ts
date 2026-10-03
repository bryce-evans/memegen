import type { ComponentType } from "react";
import type { ButtonProps, FileButtonProps, IconButtonProps, LinkButtonProps, SegmentedControlProps } from "./components/buttons.tsx";
import type {
  AlertProps,
  BadgeProps,
  CardMetaProps,
  CardProps,
  CardTitleProps,
  ChipGroupProps,
  ChipProps,
  DialogProps,
  EmptyStateProps,
  MediaGridProps,
  PanelProps,
  ProgressBarProps,
  SpinnerProps,
  TextProps,
  WordmarkProps,
} from "./components/display.tsx";
import type { ColorFieldProps, FieldProps, SelectFieldProps, SliderProps, TextAreaProps, TextFieldProps } from "./components/fields.tsx";
import type { IconProps } from "./components/Icon.tsx";
import type {
  AppShellProps,
  HeaderProps,
  InlineProps,
  NavItemProps,
  NavListProps,
  PageHeaderProps,
  SidebarProps,
  SidebarSectionProps,
  StackProps,
} from "./components/layout.tsx";
import type { SkinSwitcherProps } from "./components/SkinSwitcher.tsx";

/**
 * Every replaceable component and the props its replacement receives. Polymorphic components (`as`) pass the
 * caller's `as` through; a replacement should render it (or ignore it deliberately).
 */
export interface ComponentOverrides {
  Alert: ComponentType<AlertProps>;
  AppShell: ComponentType<AppShellProps>;
  Badge: ComponentType<BadgeProps>;
  Button: ComponentType<ButtonProps>;
  Card: ComponentType<CardProps>;
  CardMeta: ComponentType<CardMetaProps>;
  CardTitle: ComponentType<CardTitleProps>;
  Chip: ComponentType<ChipProps>;
  ChipGroup: ComponentType<ChipGroupProps>;
  ColorField: ComponentType<ColorFieldProps>;
  Dialog: ComponentType<DialogProps>;
  EmptyState: ComponentType<EmptyStateProps>;
  Field: ComponentType<FieldProps>;
  FileButton: ComponentType<FileButtonProps>;
  Header: ComponentType<HeaderProps>;
  Icon: ComponentType<IconProps>;
  IconButton: ComponentType<IconButtonProps>;
  Inline: ComponentType<InlineProps>;
  LinkButton: ComponentType<LinkButtonProps>;
  MediaGrid: ComponentType<MediaGridProps>;
  NavItem: ComponentType<NavItemProps>;
  NavList: ComponentType<NavListProps>;
  PageHeader: ComponentType<PageHeaderProps>;
  Panel: ComponentType<PanelProps>;
  ProgressBar: ComponentType<ProgressBarProps>;
  SegmentedControl: ComponentType<SegmentedControlProps>;
  SelectField: ComponentType<SelectFieldProps>;
  Sidebar: ComponentType<SidebarProps>;
  SidebarSection: ComponentType<SidebarSectionProps>;
  SkinSwitcher: ComponentType<SkinSwitcherProps>;
  Slider: ComponentType<SliderProps>;
  Spinner: ComponentType<SpinnerProps>;
  Stack: ComponentType<StackProps>;
  Text: ComponentType<TextProps>;
  TextArea: ComponentType<TextAreaProps>;
  TextField: ComponentType<TextFieldProps>;
  Wordmark: ComponentType<WordmarkProps>;
}
