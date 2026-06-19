use serde::Serialize;
use tauri::{AppHandle, Emitter};

const BAND_COUNT: usize = 18;
const SAMPLE_WINDOW: usize = 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioOutputLevels {
    peak: f32,
    bands: [f32; BAND_COUNT],
}

pub fn start_audio_meter(app: AppHandle) {
    #[cfg(target_os = "windows")]
    std::thread::spawn(move || windows_audio_meter_loop(app));

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "windows")]
fn windows_audio_meter_loop(app: AppHandle) {
    if let Err(error) = windows_audio::initialize_com() {
        log::warn!("Could not initialize Windows audio meter COM apartment: {error}");
        return;
    }

    let mut bands = [0.0_f32; BAND_COUNT];
    let mut analyzer = SpectrumAnalyzer::new();
    let mut capture = match windows_audio::LoopbackCapture::new() {
        Ok(capture) => capture,
        Err(error) => {
            log::warn!("Could not start Windows loopback audio capture: {error}");
            windows_peak_meter_loop(app, bands);
            return;
        }
    };

    loop {
        let samples_read = match capture.read_samples(|sample| analyzer.push(sample)) {
            Ok(count) => count,
            Err(error) => {
                log::debug!("Could not read Windows loopback packet: {error}");
                0
            }
        };

        let target_bands = analyzer.bands(capture.sample_rate());
        smooth_bands(&mut bands, target_bands);
        let peak = analyzer.peak();

        let _ = app.emit("audio-output-levels", AudioOutputLevels { peak, bands });
        std::thread::sleep(std::time::Duration::from_millis(if samples_read == 0 { 12 } else { 24 }));
    }
}

#[cfg(target_os = "windows")]
fn windows_peak_meter_loop(app: AppHandle, mut bands: [f32; BAND_COUNT]) {
    let mut frame = 0.0_f32;

    loop {
        let peak = match windows_audio::default_output_peak() {
            Ok(value) => value.clamp(0.0, 1.0),
            Err(error) => {
                log::debug!("Could not read Windows output peak: {error}");
                0.0
            }
        };

        frame += 0.34;
        let target_bands = shaped_peak_bands(peak, frame);
        smooth_bands(&mut bands, target_bands);

        let _ = app.emit("audio-output-levels", AudioOutputLevels { peak, bands });
        std::thread::sleep(std::time::Duration::from_millis(33));
    }
}

#[cfg(target_os = "windows")]
fn smooth_bands(bands: &mut [f32; BAND_COUNT], targets: [f32; BAND_COUNT]) {
    for (band, target) in bands.iter_mut().zip(targets) {
        let attack = if target > *band { 0.64 } else { 0.18 };
        *band += (target - *band) * attack;
    }
}

#[cfg(target_os = "windows")]
fn shaped_peak_bands(peak: f32, frame: f32) -> [f32; BAND_COUNT] {
    let mut bands = [0.0_f32; BAND_COUNT];

    for (index, band) in bands.iter_mut().enumerate() {
        let x = index as f32;
        let ripple = ((frame + x * 0.81).sin() * 0.5 + 0.5) * 0.5;
        let stagger = ((frame * 0.63 + x * 1.37).cos() * 0.5 + 0.5) * 0.35;
        let bass_bias = 1.18 - (x / BAND_COUNT as f32) * 0.38;
        *band = (peak.powf(0.62) * bass_bias * (0.3 + ripple + stagger)).clamp(0.0, 1.0);
    }

    bands
}

#[cfg(target_os = "windows")]
struct SpectrumAnalyzer {
    samples: [f32; SAMPLE_WINDOW],
    write_index: usize,
    filled: bool,
}

#[cfg(target_os = "windows")]
impl SpectrumAnalyzer {
    fn new() -> Self {
        Self {
            samples: [0.0; SAMPLE_WINDOW],
            write_index: 0,
            filled: false,
        }
    }

    fn push(&mut self, sample: f32) {
        self.samples[self.write_index] = sample.clamp(-1.0, 1.0);
        self.write_index = (self.write_index + 1) % SAMPLE_WINDOW;
        if self.write_index == 0 {
            self.filled = true;
        }
    }

    fn ordered_samples(&self) -> [f32; SAMPLE_WINDOW] {
        let mut ordered = [0.0_f32; SAMPLE_WINDOW];
        if !self.filled {
            ordered[..self.write_index].copy_from_slice(&self.samples[..self.write_index]);
            return ordered;
        }

        let tail_len = SAMPLE_WINDOW - self.write_index;
        ordered[..tail_len].copy_from_slice(&self.samples[self.write_index..]);
        ordered[tail_len..].copy_from_slice(&self.samples[..self.write_index]);
        ordered
    }

    fn peak(&self) -> f32 {
        self.samples
            .iter()
            .fold(0.0_f32, |peak, sample| peak.max(sample.abs()))
            .clamp(0.0, 1.0)
    }

    fn bands(&self, sample_rate: u32) -> [f32; BAND_COUNT] {
        let samples = self.ordered_samples();
        let mut bands = [0.0_f32; BAND_COUNT];
        let nyquist = sample_rate as f32 * 0.5;
        let min_hz = 45.0_f32;
        let max_hz = nyquist.min(16_000.0);

        for (index, band) in bands.iter_mut().enumerate() {
            let start_ratio = index as f32 / BAND_COUNT as f32;
            let end_ratio = (index + 1) as f32 / BAND_COUNT as f32;
            let start_hz = log_lerp(min_hz, max_hz, start_ratio);
            let end_hz = log_lerp(min_hz, max_hz, end_ratio);
            let magnitude = dft_band_magnitude(&samples, sample_rate, start_hz, end_hz);
            let position = index as f32 / (BAND_COUNT - 1) as f32;
            let spectrum_tilt = 0.42 + position.powf(1.25) * 3.35;
            let shaped = (magnitude * 12.5 * spectrum_tilt).powf(0.88);
            *band = shaped.clamp(0.0, 1.0);
        }

        bands
    }
}

#[cfg(target_os = "windows")]
fn log_lerp(start: f32, end: f32, ratio: f32) -> f32 {
    start * (end / start).powf(ratio)
}

#[cfg(target_os = "windows")]
fn dft_band_magnitude(
    samples: &[f32; SAMPLE_WINDOW],
    sample_rate: u32,
    start_hz: f32,
    end_hz: f32,
) -> f32 {
    let start_bin = hz_to_bin(start_hz, sample_rate).max(1);
    let end_bin = hz_to_bin(end_hz, sample_rate).max(start_bin);
    let bin_count = end_bin - start_bin + 1;
    let sample_count = bin_count.clamp(2, 6);
    let mut sum = 0.0_f32;
    let mut max = 0.0_f32;

    for index in 0..sample_count {
        let ratio = if sample_count == 1 {
            0.0
        } else {
            index as f32 / (sample_count - 1) as f32
        };
        let bin = start_bin + (ratio * (bin_count - 1) as f32).round() as usize;
        let magnitude = dft_bin_magnitude(samples, bin);
        sum += magnitude;
        max = max.max(magnitude);
    }

    let average = sum / sample_count as f32;
    (max * 0.68 + average * 0.32).max(0.00002) - 0.00002
}

#[cfg(target_os = "windows")]
fn hz_to_bin(hz: f32, sample_rate: u32) -> usize {
    ((hz / sample_rate as f32) * SAMPLE_WINDOW as f32).round() as usize
}

#[cfg(target_os = "windows")]
fn dft_bin_magnitude(samples: &[f32; SAMPLE_WINDOW], bin: usize) -> f32 {
    let mut real = 0.0_f32;
    let mut imag = 0.0_f32;
    let bin = bin.min(SAMPLE_WINDOW / 2);

    for (index, sample) in samples.iter().enumerate() {
        let window = 0.5 - 0.5 * (std::f32::consts::TAU * index as f32 / (SAMPLE_WINDOW - 1) as f32).cos();
        let angle = std::f32::consts::TAU * bin as f32 * index as f32 / SAMPLE_WINDOW as f32;
        real += sample * window * angle.cos();
        imag -= sample * window * angle.sin();
    }

    ((real * real + imag * imag).sqrt() / SAMPLE_WINDOW as f32).clamp(0.0, 1.0)
}

#[cfg(target_os = "windows")]
mod windows_audio {
    use core::ffi::c_void;

    use windows::{
        Win32::{
            Media::Audio::{
                eConsole, eRender, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK, Endpoints::IAudioMeterInformation, IAudioCaptureClient,
                IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, WAVE_FORMAT_PCM,
                WAVEFORMATEX,
            },
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
            },
        },
    };

    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;

    pub struct LoopbackCapture {
        _client: IAudioClient,
        capture: IAudioCaptureClient,
        format: AudioFormat,
    }

    #[derive(Clone, Copy)]
    struct AudioFormat {
        channels: usize,
        sample_rate: u32,
        bits_per_sample: usize,
        block_align: usize,
        sample_kind: SampleKind,
    }

    #[derive(Clone, Copy)]
    enum SampleKind {
        Float32,
        Pcm16,
        Pcm24,
        Pcm32,
    }

    pub fn initialize_com() -> windows::core::Result<()> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }
    }

    impl LoopbackCapture {
        pub fn new() -> windows::core::Result<Self> {
            unsafe {
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
                let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
                let mix_format = MixFormat::new(client.GetMixFormat()?);
                let format = mix_format.audio_format();

                client.Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    1_000_000,
                    0,
                    mix_format.as_ptr(),
                    None,
                )?;

                let capture = client.GetService::<IAudioCaptureClient>()?;
                client.Start()?;

                Ok(Self {
                    _client: client,
                    capture,
                    format,
                })
            }
        }

        pub fn sample_rate(&self) -> u32 {
            self.format.sample_rate
        }

        pub fn read_samples(&mut self, mut on_sample: impl FnMut(f32)) -> windows::core::Result<usize> {
            let mut total_frames = 0_usize;

            unsafe {
                loop {
                    let packet_frames = self.capture.GetNextPacketSize()?;
                    if packet_frames == 0 {
                        break;
                    }

                    let mut data = core::ptr::null_mut::<u8>();
                    let mut frames = 0_u32;
                    let mut flags = 0_u32;
                    self.capture
                        .GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;

                    if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 == 0 {
                        self.read_packet(data, frames as usize, &mut on_sample);
                    }

                    self.capture.ReleaseBuffer(frames)?;
                    total_frames += frames as usize;
                }
            }

            Ok(total_frames)
        }

        unsafe fn read_packet(&self, data: *const u8, frames: usize, on_sample: &mut impl FnMut(f32)) {
            if data.is_null() || self.format.channels == 0 {
                return;
            }

            let bytes = core::slice::from_raw_parts(data, frames * self.format.block_align);
            for frame in bytes.chunks_exact(self.format.block_align) {
                let mut mono = 0.0_f32;
                for channel in 0..self.format.channels {
                    let offset = channel * self.format.bits_per_sample / 8;
                    mono += self.format.sample_kind.read(&frame[offset..]);
                }
                on_sample(mono / self.format.channels as f32);
            }
        }
    }

    impl SampleKind {
        fn read(self, bytes: &[u8]) -> f32 {
            match self {
                Self::Float32 => {
                    let mut data = [0_u8; 4];
                    data.copy_from_slice(&bytes[..4]);
                    f32::from_le_bytes(data)
                }
                Self::Pcm16 => {
                    let mut data = [0_u8; 2];
                    data.copy_from_slice(&bytes[..2]);
                    i16::from_le_bytes(data) as f32 / i16::MAX as f32
                }
                Self::Pcm24 => {
                    let value = ((bytes[0] as i32) << 8) | ((bytes[1] as i32) << 16) | ((bytes[2] as i32) << 24);
                    (value >> 8) as f32 / 8_388_607.0
                }
                Self::Pcm32 => {
                    let mut data = [0_u8; 4];
                    data.copy_from_slice(&bytes[..4]);
                    i32::from_le_bytes(data) as f32 / i32::MAX as f32
                }
            }
        }
    }

    struct MixFormat(*mut WAVEFORMATEX);

    impl MixFormat {
        fn new(format: *mut WAVEFORMATEX) -> Self {
            Self(format)
        }

        fn as_ptr(&self) -> *const WAVEFORMATEX {
            self.0
        }

        unsafe fn audio_format(&self) -> AudioFormat {
            let format = *self.0;
            let mut tag = format.wFormatTag;
            let bits_per_sample = format.wBitsPerSample as usize;

            if tag == WAVE_FORMAT_EXTENSIBLE {
                let sub_format = core::ptr::addr_of!((*(self.0 as *const WaveFormatExtensiblePrefix)).sub_format)
                    .read_unaligned();
                if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
                    tag = WAVE_FORMAT_IEEE_FLOAT;
                } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
                    tag = WAVE_FORMAT_PCM as u16;
                }
            }

            let sample_kind = match (tag, bits_per_sample) {
                (WAVE_FORMAT_IEEE_FLOAT, 32) => SampleKind::Float32,
                (tag, 16) if tag == WAVE_FORMAT_PCM as u16 => SampleKind::Pcm16,
                (tag, 24) if tag == WAVE_FORMAT_PCM as u16 => SampleKind::Pcm24,
                (tag, 32) if tag == WAVE_FORMAT_PCM as u16 => SampleKind::Pcm32,
                _ => SampleKind::Float32,
            };

            AudioFormat {
                channels: format.nChannels as usize,
                sample_rate: format.nSamplesPerSec,
                bits_per_sample,
                block_align: format.nBlockAlign as usize,
                sample_kind,
            }
        }
    }

    impl Drop for MixFormat {
        fn drop(&mut self) {
            unsafe {
                CoTaskMemFree(Some(self.0 as *const c_void));
            }
        }
    }

    #[repr(C, packed(1))]
    struct WaveFormatExtensiblePrefix {
        format: WAVEFORMATEX,
        valid_bits_per_sample: u16,
        channel_mask: u32,
        sub_format: windows::core::GUID,
    }

    const KSDATAFORMAT_SUBTYPE_PCM: windows::core::GUID =
        windows::core::GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
    const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: windows::core::GUID =
        windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

    pub fn default_output_peak() -> windows::core::Result<f32> {
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let meter: IAudioMeterInformation = device.Activate(CLSCTX_ALL, None)?;
            meter.GetPeakValue()
        }
    }
}
