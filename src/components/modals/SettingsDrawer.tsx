import React from 'react';
import type { ColorPalette, ParallaxConfig } from '../../types';
import { PRESET_THEMES } from '../../utils/palette';
import { X, Sliders, Palette, Check, Eye } from 'lucide-react';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  palette: ColorPalette;
  onChangePalette: (newPalette: ColorPalette) => void;
  parallax: ParallaxConfig;
  onChangeParallax: (newParallax: ParallaxConfig) => void;
  coverArt?: string;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen,
  onClose,
  palette,
  onChangePalette,
  parallax,
  onChangeParallax,
  coverArt,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-md h-full bg-zinc-950/95 border-l border-white/10 p-6 flex flex-col justify-between overflow-y-auto select-none shadow-2xl">
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <Sliders className="w-5 h-5 text-rose-400" />
              <h2 className="text-lg font-bold text-white">Görsel & Efekt Ayarları</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Color Palettes Section */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                <Palette className="w-4 h-4 text-zinc-400" />
                Renk Teması
              </span>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-zinc-400">Auto Sync (Albüm Kapağı)</span>
                <input
                  type="checkbox"
                  checked={palette.autoSync}
                  onChange={(e) => onChangePalette({ ...palette, autoSync: e.target.checked })}
                  className="rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-0 cursor-pointer"
                />
              </label>
            </div>

            {palette.autoSync && (
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-2.5">
                  {coverArt ? (
                    <img
                      src={coverArt}
                      alt="Albüm Kapağı"
                      className="w-9 h-9 rounded-lg object-cover border border-white/20"
                    />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-lg border border-white/20"
                      style={{ backgroundColor: palette.highlight }}
                    />
                  )}
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-white">Albüm Kapağı Senkronu Aktif</span>
                    <span className="text-[11px] text-zinc-400">Şarkı değiştikçe tema rengi otomatik uyarlanır</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                    style={{ backgroundColor: palette.highlight }}
                  />
                  <div
                    className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                    style={{ backgroundColor: palette.primary }}
                  />
                </div>
              </div>
            )}

            {/* Presets */}
            <div className="grid grid-cols-1 gap-2">
              {PRESET_THEMES.map((theme) => {
                const isSelected =
                  !palette.autoSync &&
                  palette.highlight.toLowerCase() === theme.palette.highlight.toLowerCase();

                return (
                  <button
                    key={theme.name}
                    onClick={() => onChangePalette({ ...theme.palette, autoSync: false })}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-rose-500 bg-rose-500/10'
                        : 'border-white/5 bg-zinc-900/60 hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <div
                          className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                          style={{ backgroundColor: theme.palette.highlight }}
                        />
                        <div
                          className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                          style={{ backgroundColor: theme.palette.primary }}
                        />
                      </div>
                      <span className="text-xs font-medium text-white">{theme.name}</span>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-rose-400" />}
                  </button>
                );
              })}
            </div>

            {/* Manual Color Wells */}
            {!palette.autoSync && (
              <div className="grid grid-cols-3 gap-2 pt-2">
                <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-zinc-900 border border-white/5">
                  <span className="text-[11px] text-zinc-400 font-medium">Çıkartma / Highlight</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={palette.highlight}
                      onChange={(e) => onChangePalette({ ...palette, highlight: e.target.value })}
                      className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent"
                    />
                    <span className="text-[10px] font-mono text-zinc-300 uppercase">{palette.highlight}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-zinc-900 border border-white/5">
                  <span className="text-[11px] text-zinc-400 font-medium">Ana Söz</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={palette.primary}
                      onChange={(e) => onChangePalette({ ...palette, primary: e.target.value })}
                      className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent"
                    />
                    <span className="text-[10px] font-mono text-zinc-300 uppercase">{palette.primary}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-zinc-900 border border-white/5">
                  <span className="text-[11px] text-zinc-400 font-medium">Sönük Söz</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={palette.secondary.startsWith('#') ? palette.secondary : '#4c0519'}
                      onChange={(e) => onChangePalette({ ...palette, secondary: e.target.value })}
                      className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent"
                    />
                    <span className="text-[10px] font-mono text-zinc-300 uppercase">Dim</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Fisheye & Parallax Controls */}
          <div className="flex flex-col gap-4 pt-4 border-t border-white/10">
            <span className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
              <Eye className="w-4 h-4 text-rose-400" />
              Balıkgözü (Fisheye Lens) & 3D Paralaks
            </span>

            {/* Balıkgözü Mercek Bükülmesi */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Mercek Dışbükeyliği (Curvature)</span>
                <span className="text-white font-mono">{parallax.lensCurvature}%</span>
              </div>
              <input
                type="range"
                min={20}
                max={100}
                value={parallax.lensCurvature}
                onChange={(e) => onChangeParallax({ ...parallax, lensCurvature: parseInt(e.target.value) })}
                className="w-full accent-rose-500 cursor-pointer"
              />
            </div>

            {/* Paralaks Hassasiyeti */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Paralaks Fare Eğimi (Sensitivity)</span>
                <span className="text-white font-mono">{parallax.sensitivity}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={parallax.sensitivity}
                onChange={(e) => onChangeParallax({ ...parallax, sensitivity: parseInt(e.target.value) })}
                className="w-full accent-rose-500 cursor-pointer"
              />
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-2.5 pt-1">
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/60 border border-white/5 cursor-pointer">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-white">İnteraktif 3D Fare Paralaksı</span>
                  <span className="text-[11px] text-zinc-400">Fare hareket ettikçe sözler 3D uzayda eğrilir</span>
                </div>
                <input
                  type="checkbox"
                  checked={parallax.mouseParallax}
                  onChange={(e) => onChangeParallax({ ...parallax, mouseParallax: e.target.checked })}
                  className="rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-0 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900/60 border border-white/5 cursor-pointer">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-white">Emoji Rozetleri</span>
                  <span className="text-[11px] text-zinc-400">Kelimelerin yanına eşleşen emojiler gelsin</span>
                </div>
                <input
                  type="checkbox"
                  checked={parallax.showEmojis}
                  onChange={(e) => onChangeParallax({ ...parallax, showEmojis: e.target.checked })}
                  className="rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-0 cursor-pointer"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-6 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full bg-white text-black font-bold text-xs hover:scale-105 transition-all shadow-md"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
};
