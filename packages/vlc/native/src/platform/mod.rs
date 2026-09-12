#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

use napi::{Error, Status};

pub fn read_handle<const N: usize>(handle: &[u8], name: &str) -> napi::Result<[u8; N]> {
  handle
    .try_into()
    .map_err(|_| Error::new(Status::InvalidArg, format!("invalid {name} handle")))
}

#[cfg(test)]
mod tests {
  use super::read_handle;

  #[test]
  fn reads_a_native_handle() {
    assert_eq!(
      read_handle::<4>(&[1, 2, 3, 4], "test").unwrap(),
      [1, 2, 3, 4]
    );
  }

  #[test]
  fn rejects_a_short_handle() {
    assert!(read_handle::<4>(&[1, 2, 3], "test").is_err());
  }

  #[test]
  fn rejects_a_long_handle() {
    assert!(read_handle::<4>(&[1, 2, 3, 4, 5], "test").is_err());
  }
}
