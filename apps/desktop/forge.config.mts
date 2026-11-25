import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const distribution = process.env.SUPAHELP_MAC_DISTRIBUTION === '1';
const identity = process.env.SUPAHELP_MAC_SIGN_IDENTITY;
const keychainProfile = process.env.SUPAHELP_MAC_NOTARY_PROFILE;
if (
  distribution &&
  (!identity?.startsWith('Developer ID Application:') ||
    !keychainProfile?.trim())
) {
  throw new Error(
    'macOS distribution requires SUPAHELP_MAC_SIGN_IDENTITY (Developer ID Application) and SUPAHELP_MAC_NOTARY_PROFILE. Local packages are not recipient-ready.',
  );
}

// Windows signing via Azure Artifact Signing (signtool + dlib). Opt-in: the CI job sets
// SUPAHELP_WIN_SIGN=1 only when the Azure account is configured, so local and
// dry-run builds stay unsigned. Env vars are set by the maintainers' release workflow.
const winSign = process.env.SUPAHELP_WIN_SIGN === '1';
const signtool = process.env.SIGNTOOL_PATH;
const dlib = process.env.AZURE_CODE_SIGNING_DLIB;
const metadata = process.env.AZURE_METADATA_JSON;
if (winSign && !(signtool && dlib && metadata)) {
  throw new Error(
    'Windows signing requires SIGNTOOL_PATH, AZURE_CODE_SIGNING_DLIB and AZURE_METADATA_JSON.',
  );
}
const windowsSign = winSign
  ? {
      signToolPath: signtool,
      // Array form is passed to signtool verbatim (paths may contain spaces).
      signWithParams: ['/v', '/dlib', dlib!, '/dmdf', metadata!],
      // Artifact Signing certs live 3 days; the timestamp keeps signatures valid after.
      timestampServer: 'http://timestamp.acs.microsoft.com',
      // sha256 only (default also signs sha1). `as never`: HASHES enum lives in a transitive package.
      hashes: ['sha256'] as never,
    }
  : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.supahelp.desktop',
    appCategoryType: 'public.app-category.productivity',
    icon: 'assets/supahelp',
    // Ship the license and notices inside every build (Electron's own ship in its framework).
    extraResource: [
      '../../LICENSE',
      '../../NOTICE',
      '../../THIRD_PARTY_NOTICES.md',
    ],
    ...(distribution
      ? {
          osxSign: { identity, continueOnError: false },
          osxNotarize: { keychainProfile: keychainProfile! },
        }
      : {
          // Local integrity only; ad-hoc signing does not satisfy Gatekeeper.
          osxSign: {
            identity: '-',
            identityValidation: false,
            continueOnError: false,
            // Ad-hoc code has no team ID for hardened library validation.
            optionsForFile: () => ({ hardenedRuntime: false }),
          },
        }),
    protocols: [{ name: 'Supahelp', schemes: ['supahelp'] }],
    ...(windowsSign ? { windowsSign } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      setupIcon: 'assets/supahelp.ico',
      // Squirrel writes this URL into the uninstall entry (Settings > Installed apps).
      // Default is the Electron icon. Must be publicly reachable at install time.
      iconUrl: 'https://supahelp.app/assets/brand/supahelp.ico',
      windowsSign,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDMG(
      {
        format: 'ULFO',
        // Volume icon (title bar, mounted disk). Default is the Electron icon.
        icon: 'assets/supahelp.icns',
        // Window is 660x400; appdmg picks up background@2x.png next to this file for Retina.
        // Regenerate with `python3 scripts/build-dmg-background.py`.
        background: 'assets/dmg/background.png',
        iconSize: 128,
        additionalDMGOptions: { window: { size: { width: 660, height: 400 } } },
        // Icon centers; the arrow in the background sits at x=330, y=185.
        contents: (opts) => [
          { x: 170, y: 185, type: 'file', path: opts.appPath },
          { x: 490, y: 185, type: 'link', path: '/Applications' },
        ],
      },
      ['darwin'],
    ),
    new MakerRpm({ options: { icon: 'assets/supahelp.png' } }),
    new MakerDeb({ options: { icon: 'assets/supahelp.png' } }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
