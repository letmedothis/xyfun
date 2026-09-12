use std::ffi::c_void;

use napi::{Error, Status};

use crate::api::LibVlcApi;
use crate::ffi::LibvlcMediaPlayer;
use crate::platform::read_handle;
use crate::util::to_napi_error;

pub unsafe fn apply_output_window(
  api: &LibVlcApi,
  player: *mut LibvlcMediaPlayer,
  handle: &[u8],
) -> napi::Result<()> {
  let raw = usize::from_ne_bytes(read_handle(handle, "HWND")?);
  if raw == 0 {
    return Err(Error::new(
      Status::InvalidArg,
      "window handle must not be zero".to_string(),
    ));
  }

  match api.libvlc_media_player_set_hwnd {
    Some(setter) => setter(player, raw as *mut c_void),
    None => return Err(to_napi_error("libVLC does not expose hwnd setter")),
  }

  Ok(())
}
